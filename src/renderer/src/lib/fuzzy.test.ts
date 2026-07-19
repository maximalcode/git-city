import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyFilter } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports the hit indices', () => {
    const m = fuzzyMatch('cmp', 'city/components/Buildings.tsx')
    expect(m).not.toBeNull()
    expect(m!.indices.length).toBe(3)
  })

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'city/components')).toBeNull()
  })

  it('empty query matches anything with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
  })

  it('rewards consecutive runs over scattered matches', () => {
    const run = fuzzyMatch('build', 'aBuildingsxxxxxxx')!
    const scattered = fuzzyMatch('build', 'bxuxixlxdxxxxxxxx')!
    expect(run.score).toBeGreaterThan(scattered.score)
  })

  it('rewards word-start hits after a path separator', () => {
    const boundary = fuzzyMatch('b', 'src/Buildings.tsx')!
    const mid = fuzzyMatch('b', 'aaabaaaa')!
    expect(boundary.score).toBeGreaterThan(mid.score)
  })
})

describe('fuzzyFilter', () => {
  const files = ['a/one.ts', 'b/two.ts', 'c/three.ts', 'src/Buildings.tsx']

  it('ranks the best match first', () => {
    const out = fuzzyFilter('build', files, (f) => f)
    expect(out[0]).toBe('src/Buildings.tsx')
  })

  it('drops non-matches', () => {
    const out = fuzzyFilter('zzz', files, (f) => f)
    expect(out).toEqual([])
  })

  it('empty query returns the head of the list, capped at the limit', () => {
    const out = fuzzyFilter('', files, (f) => f, 2)
    expect(out).toEqual(['a/one.ts', 'b/two.ts'])
  })

  it('is stable for equal scores (original order preserved)', () => {
    const items = ['xa', 'xb', 'xc']
    const out = fuzzyFilter('x', items, (f) => f)
    expect(out).toEqual(['xa', 'xb', 'xc'])
  })
})
