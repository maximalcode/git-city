import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { rehearseMerge, rehearsalShow } from './rehearsal'
import { applyRehearsal } from './rehearsalRecovery'
import {
  continueRehearsal,
  readRehearsalConflict,
  saveRehearsalConflict
} from './rehearsalConflicts'
import { mergeBranch } from './git/merge'
import type { RehearsalReport, RehearsalResult } from '../shared/types'

const tool = process.env.GIT_CITY_REHEARSE_BIN
const roots: string[] = []
const reports: RehearsalReport[] = []
const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
function report(result: RehearsalResult): RehearsalReport {
  if (result.kind !== 'report') throw new Error(JSON.stringify(result))
  reports.push(result.report)
  return result.report
}
afterEach(async () => {
  for (const item of reports.splice(0))
    spawnSync(tool!, ['--json', 'discard', item.id], { cwd: item.repository })
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(conflict = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-city-execution-'))
  roots.push(root)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'file.txt'), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'base')
  git(root, 'checkout', '-b', 'topic')
  await writeFile(join(root, 'file.txt'), 'topic\n')
  git(root, 'commit', '-am', 'topic')
  git(root, 'checkout', 'main')
  await writeFile(join(root, conflict ? 'file.txt' : 'main.txt'), 'main\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'main')
  return root
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const paths = await readdir(root, { recursive: true, withFileTypes: true })
  const result: Record<string, string> = {}
  for (const path of paths)
    if (path.isFile()) {
      const absolute = join(path.parentPath, path.name)
      result[absolute.slice(root.length)] = (await readFile(absolute)).toString('hex')
    }
  return result
}

describe.skipIf(!tool)('real execution conditions through the app adapter', () => {
  it('preserves a real SSH signature through Apply and exposes signing failures without downgrade', async () => {
    const root = await fixture()
    const keyDir = await mkdtemp(join(tmpdir(), 'git-city-test-key-'))
    roots.push(keyDir)
    const key = join(keyDir, 'key')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', key], { stdio: 'ignore' })
    await writeFile(
      join(keyDir, 'allowed'),
      `test@example.invalid ${await readFile(key + '.pub', 'utf8')}`
    )
    git(root, 'config', 'gpg.format', 'ssh')
    git(root, 'config', 'user.signingKey', key)
    git(root, 'config', 'gpg.ssh.allowedSignersFile', join(keyDir, 'allowed'))
    git(root, 'config', 'commit.gpgSign', 'true')
    const signed = report(await rehearseMerge(tool, root, 'topic'))
    expect(signed.outcome).toBe('clean')
    const tip = signed.refs.find((ref) => ref.name === 'refs/heads/main')!.after!
    expect(signed.signatures).toContainEqual({
      sha: tip,
      present: true,
      verification: 'not_checked',
      trust: 'not_checked'
    })
    expect(report(await rehearsalShow(tool, signed)).signatures).toEqual(signed.signatures)
    expect((await applyRehearsal(tool, signed)).kind).toBe('applied')
    expect(git(root, 'rev-parse', 'HEAD')).toBe(tip)
    git(root, 'verify-commit', tip)
    git(root, 'checkout', '-b', 'next')
    await writeFile(join(root, 'next.txt'), 'next\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'next')
    git(root, 'checkout', 'main')
    git(root, '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'diverge')
    const before = git(root, 'rev-parse', 'HEAD')
    git(root, 'config', 'user.signingKey', join(keyDir, 'missing'))
    const failed = report(await rehearseMerge(tool, root, 'next'))
    expect(failed.outcome).toBe('stopped')
    expect(failed.can_apply).toBe(false)
    expect(failed.diagnostics).toMatch(/sign|key/i)
    expect(git(root, 'rev-parse', 'HEAD')).toBe(before)
  })

  it('skips sentinel hooks through Apply while direct Off merge runs them', async () => {
    const root = await fixture()
    const hookDir = await mkdtemp(join(tmpdir(), 'git-city-sentinel-'))
    roots.push(hookDir)
    const sentinel = join(hookDir, 'ran')
    for (const name of [
      'pre-merge-commit',
      'prepare-commit-msg',
      'commit-msg',
      'post-merge',
      'reference-transaction'
    ]) {
      await writeFile(
        join(hookDir, name),
        `#!/bin/sh\necho ran >> '${sentinel.replaceAll("'", "'\\''")}'\n`
      )
      await chmod(join(hookDir, name), 0o755)
    }
    git(root, 'config', 'core.hooksPath', hookDir)
    const before = git(root, 'rev-parse', 'HEAD')
    const preview = report(await rehearseMerge(tool, root, 'topic'))
    expect(preview.repository_hooks).toBe('disabled')
    expect((await applyRehearsal(tool, preview)).kind).toBe('applied')
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: 'ENOENT' })
    git(root, 'reset', '--hard', before)
    await rm(sentinel, { force: true })
    expect((await mergeBranch(root, 'topic')).ok).toBe(true)
    expect(await readFile(sentinel, 'utf8')).toContain('ran')
  })

  it('learns only in the sandbox, reuses copied rerere resolutions, and leaves the real cache unchanged', async () => {
    const root = await fixture(true)
    git(root, 'config', 'rerere.enabled', 'true')
    git(root, 'config', 'rerere.autoupdate', 'true')
    const first = report(await rehearseMerge(tool, root, 'topic'))
    expect(first.outcome).toBe('stopped')
    const conflict = await readRehearsalConflict(tool, first, 'file.txt')
    await saveRehearsalConflict(tool, first, 'file.txt', conflict.revision, 'resolved\n')
    expect(report(await continueRehearsal(tool, first)).outcome).toBe('clean')
    const cache = join(root, '.git/rr-cache')
    await expect(readdir(cache)).rejects.toMatchObject({ code: 'ENOENT' })
    await cp(join(first.sandbox!, '.git/rr-cache'), cache, { recursive: true })
    const before = await snapshot(cache)
    const second = report(await rehearseMerge(tool, root, 'topic'))
    expect(second.rerere_resolution_transfer).toBe('sandbox_only')
    expect(await readFile(join(second.sandbox!, 'file.txt'), 'utf8')).toBe('resolved\n')
    expect(git(second.sandbox!, 'ls-files', '-u')).toBe('')
    const final = report(await continueRehearsal(tool, second))
    expect(final.outcome).toBe('clean')
    expect((await applyRehearsal(tool, final)).kind).toBe('applied')
    expect(await snapshot(cache)).toEqual(before)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('resolved\n')
  })
})
