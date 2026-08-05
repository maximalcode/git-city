import { describe, expect, it } from 'vitest'
import { capFiles, cappedLabel, MAX_DRAWN_FILES } from './cap'
import type { CityInput } from './treemap'

const file = (path: string, weight: number): CityInput => ({ path, weight })

describe('capFiles', () => {
  it('leaves a normal repository completely alone', () => {
    const files = [file('a.ts', 10), file('b.ts', 20)]
    const out = capFiles(files, 100)
    expect(out.capped).toBe(false)
    expect(out.total).toBe(2)
    // the very same array, so nothing downstream re-sorts or re-lays-out
    expect(out.files).toBe(files)
  })

  it('does not cap at exactly the limit', () => {
    expect(capFiles([file('a.ts', 1), file('b.ts', 2)], 2).capped).toBe(false)
  })

  it('keeps the largest files and reports the true total', () => {
    const files = [file('small.ts', 1), file('huge.ts', 900), file('mid.ts', 50)]
    const out = capFiles(files, 2)
    expect(out.capped).toBe(true)
    expect(out.total).toBe(3)
    expect(out.files.map((f) => f.path)).toEqual(['huge.ts', 'mid.ts'])
  })

  it('breaks ties on path so two runs lay out identically', () => {
    const files = [file('b.ts', 5), file('a.ts', 5), file('c.ts', 5)]
    expect(capFiles(files, 2).files.map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
    // and again, from a different input order
    expect(
      capFiles([file('c.ts', 5), file('a.ts', 5), file('b.ts', 5)], 2).files.map((f) => f.path)
    ).toEqual(['a.ts', 'b.ts'])
  })

  it("does not mutate the caller's array", () => {
    const files = [file('a.ts', 1), file('z.ts', 900)]
    capFiles(files, 1)
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'z.ts'])
  })

  it('caps a TypeScript-sized monorepo to the ceiling', () => {
    const files = Array.from({ length: 81_368 }, (_, i) => file(`f${i}.ts`, i))
    const out = capFiles(files)
    expect(out.files).toHaveLength(MAX_DRAWN_FILES)
    expect(out.total).toBe(81_368)
    expect(out.capped).toBe(true)
  })
})

describe('cappedLabel', () => {
  it('states both numbers, grouped', () => {
    expect(cappedLabel(20_000, 81_368)).toBe('20,000 of 81,368 files')
  })
})
