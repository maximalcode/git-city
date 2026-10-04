import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGit } from './git/exec'
import { rehearsalAvailability, rehearse, rehearseMerge, rehearsalShow } from './rehearsal'

const dirs: string[] = []
const retained: { repo: string; id: string }[] = []
afterEach(async () => {
  for (const { repo, id } of retained.splice(0))
    spawnSync(tool!, ['--json', 'discard', id], { cwd: repo })
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it('requires an explicitly configured absolute executable', async () => {
  expect((await rehearsalAvailability()).available).toBe(false)
  expect((await rehearsalAvailability('git-rehearse')).available).toBe(false)
  expect((await rehearseMerge(undefined, '/repo', '--help')).kind).toBe('refused')
  expect(
    (
      await rehearsalShow(undefined, {
        id: '',
        repository: '/repo',
        origin_worktree: '/repo',
        repository_id: '/repo/.git'
      })
    ).kind
  ).toBe('refused')
})

const tool = process.env.GIT_CITY_REHEARSE_BIN
it.each([undefined, 'git-rehearse'])(
  'keeps disabled preview unavailable before Git lookup (%s)',
  async (configuredTool) => {
    const directory = await mkdtemp(join(tmpdir(), 'git-city-disabled-rehearse-'))
    dirs.push(directory)
    expect((await rehearseMerge(configuredTool, directory, 'main')).kind).toBe('unavailable')
  }
)

describe.skipIf(!tool)('public JSON CLI integration (GIT_CITY_REHEARSE_BIN)', () => {
  it('keeps an exact merge preview and leaves original HEAD, index and files unchanged', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'git-city-rehearse-'))
    dirs.push(repo)
    await runGit(repo, ['init', '-b', 'main'])
    await runGit(repo, ['config', 'user.name', 'Test'])
    await runGit(repo, ['config', 'user.email', 'test@example.invalid'])
    await runGit(repo, ['config', 'commit.gpgSign', 'false'])
    await writeFile(join(repo, 'file.txt'), 'before\n')
    await runGit(repo, ['add', '.'])
    await runGit(repo, ['commit', '-m', 'base'])
    await runGit(repo, ['checkout', '-b', 'topic'])
    await writeFile(join(repo, 'file.txt'), 'after\n')
    await runGit(repo, ['commit', '-am', 'topic change'])
    await runGit(repo, ['checkout', 'main'])
    // Force a merge commit, so commit-related hooks would have a chance to run.
    await writeFile(join(repo, 'independent.txt'), 'main-only\n')
    await runGit(repo, ['add', '.'])
    await runGit(repo, ['commit', '-m', 'independent main'])
    const hooks = await mkdtemp(join(tmpdir(), 'git-city-hooks-'))
    dirs.push(hooks)
    const sentinel = join(hooks, 'ran')
    const quotedSentinel = "'" + sentinel.replaceAll('\\', '/').replaceAll("'", "'\"'\"'") + "'"
    for (const name of ['pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-merge']) {
      await writeFile(join(hooks, name), `#!/bin/sh\necho ran >> ${quotedSentinel}\n`)
      await chmod(join(hooks, name), 0o755)
    }
    await runGit(repo, ['config', 'core.hooksPath', hooks])
    const before = {
      head: await runGit(repo, ['rev-parse', 'HEAD']),
      index: await readFile(join(repo, '.git/index')),
      file: await readFile(join(repo, 'file.txt'))
    }
    const result = await rehearseMerge(tool, repo, 'topic')
    expect(result.kind, JSON.stringify(result)).toBe('report')
    if (result.kind !== 'report') return
    retained.push({ repo, id: result.report.id })
    expect(result.report.outcome).toBe('clean')
    expect(result.report.lifecycle).toBe('kept')
    expect(result.report.refs.length).toBeGreaterThan(0)
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(before.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
    expect(await readFile(join(repo, 'file.txt'))).toEqual(before.file)
    const shown = await rehearsalShow(tool, result.report)
    expect(shown.kind, JSON.stringify(shown)).toBe('report')
    const wrong = await rehearsalShow(tool, { ...result.report, repository_id: 'another-repo' })
    expect(wrong.kind).toBe('error')
    const rebaseNoop = await rehearse(tool, repo, 'rebase', 'main')
    if (rebaseNoop.kind !== 'report') throw new Error(JSON.stringify(rebaseNoop))
    retained.push({ repo, id: rebaseNoop.report.id })
    expect(rebaseNoop.report.outcome).toBe('clean')
    expect(rebaseNoop.report.refs).toEqual([])
    expect(rebaseNoop.report.can_apply).toBe(false)
    for (const action of ['rebase', 'cherry-pick'] as const) {
      const failed = await rehearse(
        tool,
        repo,
        action,
        action === 'rebase' ? 'missing-target' : '0'.repeat(40)
      )
      if (failed.kind !== 'report') throw new Error(JSON.stringify(failed))
      retained.push({ repo, id: failed.report.id })
      expect(failed.report.outcome).toBe('failed')
      expect(failed.report.can_apply).toBe(false)
      expect(failed.report.diagnostics).toBeTruthy()
    }
    const noop = await rehearseMerge(tool, repo, 'main')
    expect(noop.kind, JSON.stringify(noop)).toBe('report')
    if (noop.kind === 'report') {
      retained.push({ repo, id: noop.report.id })
      expect(noop.report.refs).toEqual([])
    }
    const failure = await rehearseMerge(tool, repo, 'missing-merge-target')
    expect(failure.kind).toBe('report')
    if (failure.kind === 'report') {
      retained.push({ repo, id: failure.report.id })
      expect(failure.report.outcome).toBe('failed')
      expect(failure.report.diagnostics).toContain('missing-merge-target')
    }
    // Positive control: the hook scripts are executable and detect a real commit.
    await runGit(repo, ['commit', '--allow-empty', '-m', 'hook positive control'])
    expect(await readFile(sentinel, 'utf8')).toContain('ran')
    await runGit(repo, ['config', '--unset', 'core.hooksPath'])
    await writeFile(join(repo, 'file.txt'), 'conflicting original\n')
    await runGit(repo, ['commit', '-am', 'divergent main'])
    const conflictBefore = {
      head: await runGit(repo, ['rev-parse', 'HEAD']),
      index: await readFile(join(repo, '.git/index')),
      file: await readFile(join(repo, 'file.txt'))
    }
    const conflict = await rehearseMerge(tool, repo, 'topic')
    expect(conflict.kind, JSON.stringify(conflict)).toBe('report')
    if (conflict.kind === 'report') {
      retained.push({ repo, id: conflict.report.id })
      expect(conflict.report.outcome).toBe('stopped')
      expect(conflict.report.conflicted).toBe(true)
      expect(conflict.report.conflicts[0].path).toBe('file.txt')
      expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(conflictBefore.head)
      expect(await readFile(join(repo, '.git/index'))).toEqual(conflictBefore.index)
      expect(await readFile(join(repo, 'file.txt'))).toEqual(conflictBefore.file)
    }
  })
})
