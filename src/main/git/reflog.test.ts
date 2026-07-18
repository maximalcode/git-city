import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempRepo, type FixtureRepo } from './fixtures'
import { getReflog, recoverToBranch, resetTo } from './reflog'
import { getWorkingStatus } from './status'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})
function repo(): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

function threeCommits(): FixtureRepo {
  const r = repo()
  r.write('a.txt', 'a\n')
  r.commitAll('A')
  r.write('b.txt', 'b\n')
  r.commitAll('B')
  r.write('c.txt', 'c\n')
  r.commitAll('C')
  return r
}

const head = (r: FixtureRepo): string => r.git('rev-parse', 'HEAD').trim()

describe('getReflog', () => {
  it('lists HEAD movements newest-first with parsed action + subject', async () => {
    const r = threeCommits()
    const log = await getReflog(r.path)
    expect(log.length).toBeGreaterThanOrEqual(3)
    // newest entry is the last commit
    expect(log[0].index).toBe(0)
    expect(log[0].selector).toBe('HEAD@{0}')
    expect(log[0].action).toContain('commit')
    expect(log[0].subject).toBe('C')
    expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/)
    expect(log[0].shortHash).toBe(log[0].hash.slice(0, 7))
    expect(log[0].date).toBeGreaterThan(0)
  })

  it('records a reset as its own reflog entry', async () => {
    const r = threeCommits()
    const target = r.git('rev-parse', 'HEAD~1').trim()
    await resetTo(r.path, target, 'hard')
    const log = await getReflog(r.path)
    expect(log[0].action).toContain('reset')
  })

  it('respects the limit', async () => {
    const r = threeCommits()
    expect((await getReflog(r.path, 2)).length).toBeLessThanOrEqual(2)
  })
})

describe('resetTo', () => {
  it('hard reset moves HEAD and drops later commits from the branch', async () => {
    const r = threeCommits()
    const target = r.git('rev-parse', 'HEAD~1').trim()
    expect((await resetTo(r.path, target, 'hard')).ok).toBe(true)
    expect(head(r)).toBe(target)
    expect(r.git('log', '--format=%s').trim().split('\n')).toEqual(['B', 'A'])
    // the dropped commit C is still reachable via reflog → recoverable
    const log = await getReflog(r.path)
    expect(log.some((e) => e.subject === 'C')).toBe(true)
  })

  it('soft reset keeps the working tree and staged changes', async () => {
    const r = threeCommits()
    const target = r.git('rev-parse', 'HEAD~1').trim()
    expect((await resetTo(r.path, target, 'soft')).ok).toBe(true)
    expect(head(r)).toBe(target)
    // c.txt from commit C is now a staged addition, not lost
    const status = await getWorkingStatus(r.path)
    expect(status.files.some((f) => f.path === 'c.txt')).toBe(true)
  })

  it('rejects an option-like ref', async () => {
    const r = threeCommits()
    expect((await resetTo(r.path, '--hard', 'hard')).ok).toBe(false)
  })
})

describe('recoverToBranch', () => {
  it('creates a branch at a lost commit without moving HEAD', async () => {
    const r = threeCommits()
    const lost = head(r) // commit C
    await resetTo(r.path, r.git('rev-parse', 'HEAD~1').trim(), 'hard') // drop C from the branch
    expect(head(r)).not.toBe(lost)

    expect((await recoverToBranch(r.path, 'rescue', lost)).ok).toBe(true)
    expect(r.git('rev-parse', 'rescue').trim()).toBe(lost)
    // current branch is untouched by the recovery
    expect(head(r)).not.toBe(lost)
  })

  it('rejects an option-like branch name', async () => {
    const r = threeCommits()
    expect((await recoverToBranch(r.path, '-D', head(r))).ok).toBe(false)
  })
})
