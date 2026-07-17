import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { commitGraph, layoutLanes, parseRefs } from './graph'
import { makeTempRepo, type FixtureRepo } from './fixtures'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})
function repo(): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

function lanes(nodes: { hash: string; parents: string[] }[]): {
  width: number
  laneOf: Record<string, number>
} {
  const withLane = nodes.map((n) => ({ ...n, lane: 0 }))
  const width = layoutLanes(withLane)
  const laneOf: Record<string, number> = {}
  for (const n of withLane) laneOf[n.hash] = n.lane
  return { width, laneOf }
}

describe('layoutLanes', () => {
  it('keeps a linear history in one lane', () => {
    const { width, laneOf } = lanes([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] }
    ])
    expect(width).toBe(1)
    expect(laneOf).toEqual({ a: 0, b: 0, c: 0 })
  })

  it('places a feature branch in a second lane and merges back', () => {
    // M (merge) has parents main-tip D and feature F; F's parent is base A
    const { width, laneOf } = lanes([
      { hash: 'M', parents: ['D', 'F'] },
      { hash: 'D', parents: ['A'] },
      { hash: 'F', parents: ['A'] },
      { hash: 'A', parents: [] }
    ])
    expect(width).toBeGreaterThanOrEqual(2)
    expect(laneOf.M).toBe(0)
    expect(laneOf.D).toBe(0) // first parent continues the merge's lane
    expect(laneOf.F).toBe(1) // second parent gets its own lane
    // both branches trace back to A, which collapses to one lane
    expect(laneOf.A).toBe(0)
  })

  it('handles an octopus merge (3+ parents) without losing a branch', () => {
    const { width, laneOf } = lanes([
      { hash: 'M', parents: ['A', 'B', 'C'] },
      { hash: 'A', parents: ['base'] },
      { hash: 'B', parents: ['base'] },
      { hash: 'C', parents: ['base'] },
      { hash: 'base', parents: [] }
    ])
    expect(width).toBeGreaterThanOrEqual(3)
    expect(laneOf.M).toBe(0)
    expect(laneOf.A).toBe(0) // first parent continues the lane
    // every parent got a lane, no two share one
    const parentLanes = [laneOf.A, laneOf.B, laneOf.C]
    expect(new Set(parentLanes).size).toBe(3)
    expect(laneOf.base).toBe(0) // everything converges back
  })

  it('gives two independent tips their own lanes', () => {
    const { width, laneOf } = lanes([
      { hash: 'X', parents: ['base'] },
      { hash: 'Y', parents: ['base'] },
      { hash: 'base', parents: [] }
    ])
    expect(width).toBe(2)
    expect(laneOf.X).toBe(0)
    expect(laneOf.Y).toBe(1)
    expect(laneOf.base).toBe(0)
  })
})

describe('parseRefs', () => {
  it('parses HEAD, branches, remotes and tags', () => {
    expect(parseRefs('HEAD -> main, origin/main, tag: v1.0')).toEqual([
      { name: 'HEAD', kind: 'head' },
      { name: 'main', kind: 'branch' },
      { name: 'origin/main', kind: 'remote' },
      { name: 'v1.0', kind: 'tag' }
    ])
    expect(parseRefs('')).toEqual([])
  })

  it('parses a lone detached HEAD', () => {
    expect(parseRefs('HEAD')).toEqual([{ name: 'HEAD', kind: 'head' }])
  })
})

describe('commitGraph (real repo)', () => {
  it('captures a branch + merge topology across all refs', async () => {
    const r = repo()
    r.write('a.txt', 'base\n')
    r.commitAll('base')
    r.git('switch', '-c', 'feature')
    r.write('feat.txt', 'x\n')
    r.commitAll('feature work')
    r.git('switch', 'main')
    r.write('main.txt', 'y\n')
    r.commitAll('main work')
    r.git('merge', '--no-ff', 'feature', '-m', 'merge feature')

    const g = await commitGraph(r.path, 500)
    expect(g.commits.length).toBe(4) // base, feature work, main work, merge
    // the merge commit has two parents
    const merge = g.commits.find((c) => c.subject === 'merge feature')!
    expect(merge.parents).toHaveLength(2)
    // HEAD/main decoration present on the tip
    const withHead = g.commits.find((c) => c.refs.some((ref) => ref.kind === 'head'))
    expect(withHead).toBeDefined()
    expect(g.laneCount).toBeGreaterThanOrEqual(2)
    // rows are contiguous newest-first
    expect(g.commits[0].row).toBe(0)
  })
})
