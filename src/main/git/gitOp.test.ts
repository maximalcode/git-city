import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempRepo } from './fixtures'
import { gitOp } from './gitOp'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

function repo(): ReturnType<typeof makeTempRepo> {
  const r = makeTempRepo('git-city-gitop-')
  cleanups.push(r.path)
  return r
}

/** Two commits touching one file from two branches — a guaranteed conflict. */
function conflictedRepo(): ReturnType<typeof makeTempRepo> {
  const r = repo()
  r.write('shared.txt', 'base\n')
  r.commitAll('base')
  r.git('switch', '-c', 'side')
  r.write('shared.txt', 'side\n')
  r.commitAll('side')
  r.git('switch', 'main')
  r.write('shared.txt', 'main\n')
  r.commitAll('main')
  return r
}

describe('gitOp', () => {
  it('returns ok() when git succeeds', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')
    expect(await gitOp(r.path, ['tag', 'v1'])).toEqual({ ok: true, message: undefined })
  })

  it('classifies a failure from git’s own output', async () => {
    const r = repo()
    const res = await gitOp(r.path, ['tag', '-d', 'never-existed'])
    expect(res.ok).toBe(false)
    expect(res.code).toBe('unknown')
    expect(res.message).toContain('not found')
  })

  it('attaches the conflicted files when asked and git stops on conflicts', async () => {
    const r = conflictedRepo()
    const res = await gitOp(r.path, ['merge', '--no-edit', 'side'], { conflicts: true })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')
    expect(res.conflicts).toEqual(['shared.txt'])
  })

  it('leaves the conflict list off when not asked, even on the same failure', async () => {
    const r = conflictedRepo()
    const res = await gitOp(r.path, ['merge', '--no-edit', 'side'])
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')
    expect(res.conflicts).toBeUndefined()
  })
})
