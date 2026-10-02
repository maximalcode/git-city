import { afterEach, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { compareRehearsal } from './rehearsalComparison'
import { rehearse } from './rehearsal'
import { analyzeComparison } from './git/analyze'
import { materializeSnapshot } from '../shared/snapshots'
import {
  continueRehearsal,
  readRehearsalConflict,
  saveRehearsalConflict
} from './rehearsalConflicts'

const tool = process.env.GIT_CITY_REHEARSE_BIN
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'city-compare-'))
  cleanup.push(() => rm(repo, { recursive: true, force: true }))
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(repo, 'file.txt'), 'base\n')
  await writeFile(join(repo, 'local.txt'), 'local\n')
  git('add', '.')
  git('commit', '-m', 'base')
  const before = git('rev-parse', 'HEAD')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'file.txt'), 'topic\nsecond\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  return { repo, git, before }
}

it('analyzes immutable endpoints with shared paths without switching checkout or index', async () => {
  const { repo, git, before } = await fixture()
  const index = await readFile(join(repo, '.git/index'))
  const analysis = await analyzeComparison(repo, [before, git('rev-parse', 'topic')])
  expect(materializeSnapshot(analysis, 0).files.find((f) => f.path === 'file.txt')?.loc).toBe(1)
  expect(materializeSnapshot(analysis, 1).files.find((f) => f.path === 'file.txt')?.loc).toBe(2)
  expect(git('rev-parse', 'HEAD')).toBe(before)
  expect(await readFile(join(repo, '.git/index'))).toEqual(index)
  await expect(analyzeComparison(repo, ['HEAD'])).rejects.toThrow('immutable')
})

it.skipIf(!tool)(
  'uses frozen carried objects despite changes to the real HEAD and sandbox files',
  async () => {
    const { repo, git } = await fixture()
    await writeFile(join(repo, 'local.txt'), 'local\ncarried\n')
    const result = await rehearse(tool, repo, 'merge', 'topic')
    if (result.kind !== 'report') throw new Error(JSON.stringify(result))
    const report = result.report
    cleanup.push(async () => {
      execFileSync(tool!, ['--json', 'discard', report.id], { cwd: repo })
    })
    expect(report.carried?.status).toBe('restored')
    git('commit', '-am', 'later real change')
    await writeFile(join(report.sandbox!, 'local.txt'), 'unreviewed sandbox edit\n')
    const original = {
      head: git('rev-parse', 'HEAD'),
      index: await readFile(join(repo, '.git/index'))
    }
    const data = await compareRehearsal(tool, report)
    expect(data.afterAvailable).toBe(true)
    for (const index of [0, 1])
      expect(
        materializeSnapshot(data.analysis, index).files.find((f) => f.path === 'local.txt')?.loc
      ).toBe(2)
    expect(
      materializeSnapshot(data.analysis, 0).files.find((f) => f.path === 'file.txt')?.loc
    ).toBe(1)
    expect(
      materializeSnapshot(data.analysis, 1).files.find((f) => f.path === 'file.txt')?.loc
    ).toBe(2)
    expect(git('rev-parse', 'HEAD')).toBe(original.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(original.index)
  }
)

it.skipIf(!tool)(
  'withholds After for stopped work and analyzes the fresh Continue result',
  async () => {
    const { repo, git } = await fixture()
    await writeFile(join(repo, 'file.txt'), 'main\n')
    git('commit', '-am', 'conflict')
    const result = await rehearse(tool, repo, 'merge', 'topic')
    if (result.kind !== 'report') throw new Error(JSON.stringify(result))
    const report = result.report
    cleanup.push(async () => {
      execFileSync(tool!, ['--json', 'discard', report.id], { cwd: repo })
    })
    const stopped = await compareRehearsal(tool, report)
    expect(stopped.afterAvailable).toBe(false)
    expect(stopped.analysis.snapshots).toHaveLength(1)
    const conflict = await readRehearsalConflict(tool, report, 'file.txt')
    await saveRehearsalConflict(tool, report, 'file.txt', conflict.revision, 'one\ntwo\nthree\n')
    await continueRehearsal(tool, report)
    const completed = await compareRehearsal(tool, report)
    expect(completed.afterAvailable).toBe(true)
    expect(
      materializeSnapshot(completed.analysis, 1).files.find((f) => f.path === 'file.txt')?.loc
    ).toBe(3)
  }
)
