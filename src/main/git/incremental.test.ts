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

/** `n` commits, each appending one line to a.txt. */
function withCommits(n: number): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  addCommits(r, 0, n)
  return r
}

function addCommits(r: FixtureRepo, from: number, count: number): void {
  for (let i = from; i < from + count; i++) {
    r.write('a.txt', Array.from({ length: i + 1 }, (_, k) => `line ${k}\n`).join(''))
    r.commitAll(`c${i}`)
  }
}

const sortedByPath = <T extends { path: string }>(files: T[]): T[] =>
  [...files].sort((x, y) => x.path.localeCompare(y.path))

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

  it('re-samples the timeline on splice instead of appending every commit', async () => {
    const r = withCommits(20)
    await analyzeRepo(r.path, 5, noop) // stops at 0, 5, 10, 14, 19
    addCommits(r, 20, 3)

    const inc = await analyzeIncremental(r.path)
    expect(inc).not.toBeNull()
    expect(inc!.info.commitCount).toBe(23)
    // Append-only gave 0,5,10,14,19,20,21,22 — eight stops where a full
    // analysis has five, and the last three commits crowding the scrubber's
    // right edge (#71).
    expect(inc!.snapshots.map((s) => s.index)).toEqual([0, 5, 10, 19, 22])

    // Not the *same* stops as a full analysis — it would want 0,6,11,17,22, and
    // 6, 11 and 17 were never captured. Splicing exists so that history is not
    // re-read, so the achievable claim is the one that matters to the scrubber:
    // as many stops as a full analysis, ending on the same commit.
    const full = await analyzeRepo(r.path, 5, noop)
    expect(inc!.snapshots.length).toBe(full.snapshots.length)
    expect(inc!.snapshots[inc!.snapshots.length - 1].hash).toBe(
      full.snapshots[full.snapshots.length - 1].hash
    )
  })

  it('stays bounded and exact across ten sessions of commits', async () => {
    const r = withCommits(12)
    await analyzeRepo(r.path, 5, noop)

    let inc: Awaited<ReturnType<typeof analyzeIncremental>> = null
    for (let round = 0; round < 10; round++) {
      addCommits(r, 12 + round * 2, 2)
      inc = await analyzeIncremental(r.path)
      expect(inc).not.toBeNull()
      // it used to reach 25 here, and never come back down
      expect(inc!.snapshots.length).toBeLessThanOrEqual(6)
    }
    expect(inc!.info.commitCount).toBe(32)

    // Re-sampling drops captures, so the one the *next* splice re-seeds from
    // has to be the survivor: the tip, still an exact full-state capture.
    const full = await analyzeRepo(r.path, 5, noop)
    const lastInc = materializeSnapshot(inc!, inc!.snapshots.length - 1)
    const lastFull = materializeSnapshot(full, full.snapshots.length - 1)
    expect(lastInc.hash).toBe(lastFull.hash)
    expect(sortedByPath(lastInc.files)).toEqual(sortedByPath(lastFull.files))
  })

  it('keeps sampling at the target the analysis was opened with', async () => {
    // sampleTarget is an argument to analyzeRepo and never reaches
    // analyzeIncremental, so the splice has to remember what it was told.
    const r = withCommits(10)
    await analyzeRepo(r.path, 3, noop)
    addCommits(r, 10, 4)
    const inc = await analyzeIncremental(r.path)
    expect(inc!.snapshots.length).toBeLessThanOrEqual(4)
  })
})
