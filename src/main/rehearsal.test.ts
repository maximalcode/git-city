import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGit } from './git/exec'
import { rehearsalAvailability, rehearseMerge, rehearsalShow } from './rehearsal'

const dirs: string[] = []
afterEach(async () => {
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
    const before = {
      head: await runGit(repo, ['rev-parse', 'HEAD']),
      index: await readFile(join(repo, '.git/index')),
      file: await readFile(join(repo, 'file.txt'))
    }
    const result = await rehearseMerge(tool, repo, 'topic')
    expect(result.kind, JSON.stringify(result)).toBe('report')
    if (result.kind !== 'report') return
    expect(result.report.outcome).toBe('clean')
    expect(result.report.lifecycle).toBe('kept')
    expect(result.report.refs.length).toBeGreaterThan(0)
    expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(before.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
    expect(await readFile(join(repo, 'file.txt'))).toEqual(before.file)
    const shown = await rehearsalShow(tool, result.report)
    expect(shown.kind, JSON.stringify(shown)).toBe('report')
    const wrong = await rehearsalShow(tool, { ...result.report, repository_id: 'another-repo' })
    expect(wrong.kind).toBe('error')
    // Explicit fixture cleanup, scoped to the exact returned rehearsal.
    const { spawnSync } = await import('child_process')
    spawnSync(tool!, ['--json', 'discard', result.report.id], { cwd: repo })
    const noop = await rehearseMerge(tool, repo, 'main')
    expect(noop.kind, JSON.stringify(noop)).toBe('report')
    if (noop.kind === 'report') {
      expect(noop.report.refs).toEqual([])
      spawnSync(tool!, ['--json', 'discard', noop.report.id], { cwd: repo })
    }
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
      expect(conflict.report.outcome).toBe('stopped')
      expect(conflict.report.conflicted).toBe(true)
      expect(conflict.report.conflicts[0].path).toBe('file.txt')
      expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(conflictBefore.head)
      expect(await readFile(join(repo, '.git/index'))).toEqual(conflictBefore.index)
      expect(await readFile(join(repo, 'file.txt'))).toEqual(conflictBefore.file)
      spawnSync(tool!, ['--json', 'discard', conflict.report.id], { cwd: repo })
    }
  })
})
