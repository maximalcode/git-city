import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('parallel worktree previews preserve origins and stale Apply keeps the reviewed result', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const root = await mkdtemp(join(tmpdir(), 'city-worktrees-'))
  const profile = await mkdtemp(join(tmpdir(), 'city-worktrees-profile-'))
  const repo = join(root, 'repo')
  const linked = join(root, 'linked')
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git(root, 'init', '-b', 'main', repo)
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  git(repo, 'config', 'commit.gpgSign', 'false')
  await writeFile(join(repo, 'file.txt'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const before = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-b', 'topic')
  await writeFile(join(repo, 'file.txt'), 'topic\n')
  git(repo, 'commit', '-am', 'topic')
  const target = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', 'main')
  git(repo, 'worktree', 'add', '-b', 'other', linked)
  const originalIndex = await readFile(join(repo, '.git/index'))
  const linkedIndex = await readFile(join(repo, '.git/worktrees/linked/index'))
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5199',
      GIT_CITY_REHEARSE_BIN: tool,
      GIT_REHEARSE_CACHE_DIR: join(root, 'cache')
    }
  })
  try {
    const page = await app.firstWindow()
    const results = await page.evaluate(
      ([first, second]) =>
        Promise.all([
          window.gitCity.rehearseMerge(first, 'topic'),
          window.gitCity.rehearseMerge(second, 'topic')
        ]),
      [repo, linked]
    )
    for (const result of results) expect(result.kind, JSON.stringify(result)).toBe('report')
    const [first, second] = results
    if (first.kind !== 'report' || second.kind !== 'report') throw new Error('Missing previews')
    expect(first.report.id).not.toBe(second.report.id)
    expect(first.report.repository_id).toBe(second.report.repository_id)
    expect(first.report.origin_worktree).not.toBe(second.report.origin_worktree)
    for (const path of [repo, linked]) {
      expect(git(path, 'rev-parse', 'HEAD')).toBe(before)
      expect(await readFile(join(path, 'file.txt'), 'utf8')).toBe('base\n')
    }
    expect(await readFile(join(repo, '.git/index'))).toEqual(originalIndex)
    expect(await readFile(join(repo, '.git/worktrees/linked/index'))).toEqual(linkedIndex)

    // Keep a second result on the same origin; the first Apply must stale it.
    const alternative = await page.evaluate(
      (path) => window.gitCity.rehearseMerge(path, 'topic'),
      repo
    )
    if (alternative.kind !== 'report') throw new Error(JSON.stringify(alternative))
    const applied = await page.evaluate(
      (report) => window.gitCity.rehearsalApply(report),
      first.report
    )
    expect(applied.kind, JSON.stringify(applied)).toBe('applied')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(target)
    expect(git(linked, 'rev-parse', 'HEAD')).toBe(before)
    const adoptedIndex = await readFile(join(repo, '.git/index'))
    const refused = await page.evaluate(
      (report) => window.gitCity.rehearsalApply(report),
      alternative.report
    )
    expect(refused.kind, JSON.stringify(refused)).toBe('refused')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(target)
    expect(await readFile(join(repo, '.git/index'))).toEqual(adoptedIndex)
    expect(await readFile(join(repo, 'file.txt'), 'utf8')).toBe('topic\n')
    expect(await readFile(join(repo, '.git/worktrees/linked/index'))).toEqual(linkedIndex)
    const retained = await page.evaluate(
      (report) => window.gitCity.rehearsalShow(report),
      alternative.report
    )
    expect(retained.kind, JSON.stringify(retained)).toBe('report')
    const history = await page.evaluate((path) => window.gitCity.rehearsalList(path), repo)
    expect(history.entries.find((entry) => entry.id === alternative.report.id)?.stale).toBe(true)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(profile, { recursive: true, force: true })
  }
})
