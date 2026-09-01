import { describe, expect, it } from 'vitest'
import type { FileState, RepoAnalysis, Snapshot } from '../../../shared/types'
import { buildAnalysis } from '../../../shared/snapshots'
import { cacheByLayout, layoutKey } from './modelCache'
import { buildCityModel } from './cityData'
import { buildFarmModel, CROP_KINDS } from '../layout/farm'

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

/** A builder that counts, so "did it rebuild" is asked directly. */
function counting(): { fn: (a: RepoAnalysis) => object; calls: () => number } {
  let calls = 0
  return {
    fn: () => {
      calls++
      return {}
    },
    calls: () => calls
  }
}

describe('layoutKey', () => {
  it('agrees for two analyses whose files peaked at the same sizes', () => {
    const one = analysis([snap(0, [file('a.ts', 40)])])
    // a second commit that shrank the file: same peak, different object
    const two = analysis([snap(0, [file('a.ts', 40)]), snap(1, [file('a.ts', 2)])])
    expect(layoutKey(two)).toBe(layoutKey(one))
  })

  it('differs once a file grows past its old peak', () => {
    const one = analysis([snap(0, [file('a.ts', 40)])])
    const two = analysis([snap(0, [file('a.ts', 40)]), snap(1, [file('a.ts', 900)])])
    expect(layoutKey(two)).not.toBe(layoutKey(one))
  })

  it('differs once a file appears', () => {
    const one = analysis([snap(0, [file('a.ts', 40)])])
    const two = analysis([snap(0, [file('a.ts', 40), file('b.ts', 40)])])
    expect(layoutKey(two)).not.toBe(layoutKey(one))
  })
})

describe('cacheByLayout', () => {
  it('rebuilds both worlds when a one-line peak increase changes a fractional weight', () => {
    const before = analysis([snap(0, [file('a.ts', 1199), file('b.ts', 100)])])
    const after = analysis([
      snap(0, [file('a.ts', 1199), file('b.ts', 100)]),
      snap(1, [file('a.ts', 1200), file('b.ts', 100)])
    ])
    for (const build of [buildCityModel, buildFarmModel]) {
      const cached = cacheByLayout<ReturnType<typeof build>>(build)
      const first = cached(before)
      const grown = cached(after)
      expect(grown).not.toBe(first)
      expect(grown.layout.plots).not.toEqual(first.layout.plots)
      if ('kinds' in first && 'kinds' in grown) {
        expect(CROP_KINDS[first.kinds[first.indexOf.get('a.ts')!]]).toBe('row')
        expect(CROP_KINDS[grown.kinds[grown.indexOf.get('a.ts')!]]).toBe('orchard')
      }
    }
  })

  it('builds once for an analysis asked for repeatedly (the scrub path)', () => {
    const { fn, calls } = counting()
    const cached = cacheByLayout(fn)
    const a = analysis([snap(0, [file('a.ts', 40)])])
    const model = cached(a)
    expect(cached(a)).toBe(model)
    expect(cached(a)).toBe(model)
    expect(calls()).toBe(1)
  })

  it('reuses across a commit that did not change the layout inputs', () => {
    const { fn, calls } = counting()
    const cached = cacheByLayout(fn)
    const model = cached(analysis([snap(0, [file('a.ts', 40)])]))
    const after = cached(analysis([snap(0, [file('a.ts', 40)]), snap(1, [file('a.ts', 2)])]))
    // `model` is still held here, exactly as the mounted scene holds it
    expect(after).toBe(model)
    expect(calls()).toBe(1)
  })

  it('rebuilds when the inputs change', () => {
    const { fn, calls } = counting()
    const cached = cacheByLayout(fn)
    const model = cached(analysis([snap(0, [file('a.ts', 40)])]))
    const after = cached(analysis([snap(0, [file('a.ts', 40), file('b.ts', 3)])]))
    expect(after).not.toBe(model)
    expect(calls()).toBe(2)
  })

  it('does not rebuild on the way back to a layout it still holds', () => {
    const { fn, calls } = counting()
    const cached = cacheByLayout(fn)
    const a = analysis([snap(0, [file('a.ts', 40)])])
    const first = cached(a)
    const grown = cached(analysis([snap(0, [file('a.ts', 40), file('b.ts', 3)])]))
    // one entry deep: going back is a miss, and must not hand back the wrong one
    const back = cached(a)
    expect(back).not.toBe(grown)
    expect(back).not.toBe(first)
    expect(calls()).toBe(3)
  })

  it('gives each builder its own entry, so modes do not evict each other', () => {
    const city = counting()
    const farm = counting()
    const cachedCity = cacheByLayout(city.fn)
    const cachedFarm = cacheByLayout(farm.fn)
    const a = analysis([snap(0, [file('a.ts', 40)])])
    const c = cachedCity(a)
    cachedFarm(a)
    expect(cachedCity(a)).toBe(c)
    expect(city.calls()).toBe(1)
    expect(farm.calls()).toBe(1)
  })
})
