import { describe, expect, it } from 'vitest'
import type { FileState, RepoAnalysis, Snapshot } from '../../../shared/types'
import { buildAnalysis } from '../../../shared/snapshots'
import { layoutDigest, layoutWeights } from './weights'

const file = (path: string, loc: number): FileState => ({
  path,
  loc,
  commits: 1,
  lastTouched: 0,
  lastAuthor: 'a',
  binary: false
})

const snap = (index: number, files: FileState[]): Snapshot => ({
  hash: `h${index}`,
  date: 1_700_000_000_000 + index,
  author: 'a',
  message: `c${index}`,
  index,
  files
})

const analysis = (snapshots: Snapshot[]): RepoAnalysis =>
  buildAnalysis({ name: 'r', path: '/r', branch: 'main', commitCount: 1 }, snapshots)

describe('layoutWeights', () => {
  it('takes each path at its peak across history, not its size now', () => {
    const w = layoutWeights(
      analysis([snap(0, [file('big.ts', 900)]), snap(1, [file('big.ts', 12)])])
    )
    expect(w.get('big.ts')).toBe(900)
  })

  it('keeps files that have since been deleted', () => {
    const w = layoutWeights(analysis([snap(0, [file('gone.ts', 40)]), snap(1, [])]))
    expect(w.get('gone.ts')).toBe(40)
  })

  it('floors at 1, so an empty file still gets a plot', () => {
    const w = layoutWeights(analysis([snap(0, [file('empty.ts', 0)])]))
    expect(w.get('empty.ts')).toBe(1)
  })
})

describe('layoutDigest', () => {
  it('is equal for the same pairs whatever order they arrive in', () => {
    const a = new Map([
      ['a.ts', 10],
      ['b.ts', 20]
    ])
    const b = new Map([
      ['b.ts', 20],
      ['a.ts', 10]
    ])
    expect(layoutDigest(a)).toBe(layoutDigest(b))
  })

  it('changes when a weight changes', () => {
    const before = layoutDigest(new Map([['a.ts', 10]]))
    expect(layoutDigest(new Map([['a.ts', 11]]))).not.toBe(before)
  })

  it('changes when a path is added', () => {
    const before = layoutDigest(new Map([['a.ts', 10]]))
    expect(
      layoutDigest(
        new Map([
          ['a.ts', 10],
          ['b.ts', 10]
        ])
      )
    ).not.toBe(before)
  })

  it('changes when a path is renamed at the same weight', () => {
    expect(layoutDigest(new Map([['a.ts', 10]]))).not.toBe(layoutDigest(new Map([['b.ts', 10]])))
  })

  it('separates weight from path, so a swap between two files is not a no-op', () => {
    // sum and xor are both commutative, so entries must not be interchangeable
    // just because the multiset of paths and the multiset of weights match
    const a = new Map([
      ['a.ts', 10],
      ['b.ts', 20]
    ])
    const swapped = new Map([
      ['a.ts', 20],
      ['b.ts', 10]
    ])
    expect(layoutDigest(a)).not.toBe(layoutDigest(swapped))
  })

  it('is stable across calls', () => {
    const w = new Map([
      ['a.ts', 10],
      ['b/c.ts', 3]
    ])
    expect(layoutDigest(w)).toBe(layoutDigest(new Map(w)))
  })
})
