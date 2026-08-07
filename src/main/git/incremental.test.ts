import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { analyzeIncremental, analyzeRepo } from './analyze'
import { materializeSnapshot } from '../../shared/snapshots'
import { makeTempRepo, type FixtureRepo } from './fixtures'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

const noop = (): void => {}

function seeded(): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  r.write('a.txt', 'one\ntwo\n')
  r.commitAll('first')
  r.write('b.txt', 'x\n')
  r.commitAll('second')
  return r
}

describe('analyzeIncremental', () => {
  it('returns null without a prior full analysis', async () => {
    const r = seeded()
    expect(await analyzeIncremental(r.path)).toBeNull()
  })

  it('gold test: incremental equals a fresh full analysis', async () => {
    const r = seeded()
    await analyzeRepo(r.path, 1000, noop) // sample target > commits → snapshot every commit

    r.write('a.txt', 'one\ntwo\nthree\n')
    r.commitAll('third')
    r.write('c.txt', 'new\nfile\n')
    r.commitAll('fourth')
    r.git('rm', 'b.txt')
    r.git('commit', '-m', 'fifth deletes b')

    const incremental = await analyzeIncremental(r.path)
    expect(incremental).not.toBeNull()
    const full = await analyzeRepo(r.path, 1000, noop)

    expect(incremental!.info.commitCount).toBe(full.info.commitCount)
    expect(incremental!.snapshots.length).toBe(full.snapshots.length)
    for (let i = 0; i < full.snapshots.length; i++) {
      const a = materializeSnapshot(incremental!, i)
      const b = materializeSnapshot(full, i)
      expect(a.hash).toBe(b.hash)
      expect(a.index).toBe(b.index)
      const sort = (files: { path: string }[]): unknown =>
        [...files].sort((x, y) => x.path.localeCompare(y.path))
      expect(sort(a.files)).toEqual(sort(b.files))
    }
  })

  it('returns the cached analysis when HEAD is unchanged', async () => {
    const r = seeded()
    const full = await analyzeRepo(r.path, 50, noop)
    const inc = await analyzeIncremental(r.path)
    expect(inc).not.toBeNull()
    expect(inc!.snapshots.length).toBe(full.snapshots.length)
    expect(inc!.info.commitCount).toBe(full.info.commitCount)
  })

  it('returns null after history rewrite (amend) → caller falls back to full', async () => {
    const r = seeded()
    await analyzeRepo(r.path, 50, noop)
    r.write('a.txt', 'amended\n')
    r.git('add', '-A')
    r.git('commit', '--amend', '-m', 'second (amended)')
    expect(await analyzeIncremental(r.path)).toBeNull()
  })

  it('handles a merge commit via first-parent telescoping', async () => {
    const r = seeded()
    await analyzeRepo(r.path, 1000, noop)

    r.git('switch', '-c', 'side')
    r.write('side.txt', 'side work\nmore\n')
    r.commitAll('side work')
    r.git('switch', 'main')
    r.write('main-only.txt', 'main\n')
    r.commitAll('main work')
    r.git('merge', '--no-edit', 'side')

    const incremental = await analyzeIncremental(r.path)
    expect(incremental).not.toBeNull()
    const full = await analyzeRepo(r.path, 1000, noop)

    const lastInc = materializeSnapshot(incremental!, incremental!.snapshots.length - 1)
    const lastFull = materializeSnapshot(full, full.snapshots.length - 1)
    expect(lastInc.hash).toBe(lastFull.hash)
    const locOf = (s: typeof lastInc, p: string): number | undefined =>
      s.files.find((f) => f.path === p)?.loc
    expect(locOf(lastInc, 'side.txt')).toBe(2)
    expect(locOf(lastInc, 'side.txt')).toBe(locOf(lastFull, 'side.txt'))
    expect(incremental!.info.commitCount).toBe(full.info.commitCount)
  })

  it('returns null when prevHead is reachable only as a merge parent', async () => {
    // main:    A ── B ── C          (f.txt grows 10 → 17)
    // feature: A ── D ─────── M     (M's first parent is D, second is C)
    //
    // C is an ancestor of M, so the old reachability gate let the splice
    // through — but the replay walks M's first parents, and M's diff against
    // D re-adds every line B and C put into f.txt on top of a state seeded
    // from C. Reachable in one click: check out a PR branch that has merged
    // main (#70).
    const r = makeTempRepo()
    cleanups.push(r.path)
    const lines = (n: number): string =>
      Array.from({ length: n }, (_, i) => `line ${i + 1}\n`).join('')

    r.write('f.txt', lines(10))
    r.commitAll('A')
    r.git('switch', '-c', 'feature')
    r.write('g.txt', 'g one\ng two\n')
    r.commitAll('D: feature work')
    r.git('switch', 'main')
    r.write('f.txt', lines(13))
    r.commitAll('B')
    r.write('f.txt', lines(17))
    r.commitAll('C')

    await analyzeRepo(r.path, 1000, noop) // caches main @ C
    r.git('switch', 'feature')
    r.git('merge', '--no-edit', 'main')

    expect(await analyzeIncremental(r.path)).toBeNull()

    const full = await analyzeRepo(r.path, 1000, noop)
    expect(full.info.commitCount).toBe(3) // A, D, M along first parents
    const last = materializeSnapshot(full, full.snapshots.length - 1)
    const locOf = (p: string): number | undefined => last.files.find((f) => f.path === p)?.loc
    expect(locOf('f.txt')).toBe(17) // not 17 + 7 double-counted
    expect(locOf('g.txt')).toBe(2)
  })
})
