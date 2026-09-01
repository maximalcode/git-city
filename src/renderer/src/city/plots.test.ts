import { describe, expect, it } from 'vitest'
import type { RepoAnalysis } from '../../../shared/types'
import { buildAnalysis, materializeSnapshot } from '../../../shared/snapshots'
import { buildFarmModel, farmTargets } from '../layout/farm'
import { buildCityModel, snapshotTargets } from './cityData'
import type { PlotSource } from './plots'

function analysis(
  frames = [['a.ts', 'b/c.ts', 'b/d.css', 'b/e/f.md'].map((path) => ({ path, loc: 120 }))]
): RepoAnalysis {
  return buildAnalysis(
    { name: 'r', path: '/r', branch: 'main', commitCount: frames.length },
    frames.map((files, index) => ({
      hash: `h${index}`,
      date: 1_700_000_000_000 + index,
      author: 'a',
      message: `c${index}`,
      index,
      files: files.map((f) => ({
        ...f,
        commits: 3,
        lastTouched: 0,
        lastAuthor: 'a',
        binary: false
      }))
    }))
  )
}

/**
 * Highlight, StatusOverlay and ConstructionSites are written against PlotSource
 * rather than CityModel, which is what let the farm have them at all. These pin
 * the property that makes that safe: both worlds lay files out with the same
 * treemap and agree on where a given file's rectangle is.
 */
describe('PlotSource', () => {
  const a = analysis()
  const city = buildCityModel(a)
  const farm = buildFarmModel(a)

  it('is satisfied by both worlds', () => {
    const worlds: PlotSource[] = [city, farm]
    for (const w of worlds) {
      expect(w.indexOf.size).toBeGreaterThan(0)
      expect(w.layout.plots.length).toBe(w.indexOf.size)
    }
  })

  it('resolves every path to a plot in both worlds', () => {
    for (const w of [city, farm] as PlotSource[]) {
      for (const [path, i] of w.indexOf) {
        expect(w.layout.plots[i].path).toBe(path)
      }
    }
  })

  it('gives the farm the same rectangle through layout as through rects', () => {
    // FarmModel.rects is layout.plots.map(p => p.rect); the marker layers read
    // the layout, the fields read rects, and they must not drift apart
    farm.rects.forEach((r, i) => {
      expect(farm.layout.plots[i].rect).toEqual(r)
    })
  })

  it('indexes the same files in both worlds', () => {
    expect([...farm.indexOf.keys()].sort()).toEqual([...city.indexOf.keys()].sort())
  })

  it('compresses a hundredfold line-count outlier to less than twentyfold plot area in both worlds', () => {
    const a = analysis([
      [
        { path: 'source.ts', loc: 100 },
        { path: 'generated.json', loc: 10_000 }
      ]
    ])
    for (const m of [buildCityModel(a), buildFarmModel(a)]) {
      const area = (path: string) => {
        const { w, h } = m.layout.plots[m.indexOf.get(path)!].rect
        return w * h
      }
      expect(area('generated.json')).toBeGreaterThan(area('source.ts'))
      // The weights are 10:1; leave room for the treemap's road insets, which
      // take a larger fraction of the smaller plot's allocated ground.
      expect(area('generated.json') / area('source.ts')).toBeLessThan(20)
    }
  })

  it('gives empty files positive plots that stay put as other files shrink and vanish', () => {
    const first = [
      { path: 'empty.ts', loc: 0 },
      { path: 'source.ts', loc: 400 }
    ]
    const a = analysis([first])
    const history = analysis([
      first,
      [
        { path: 'empty.ts', loc: 0 },
        { path: 'source.ts', loc: 100 }
      ],
      []
    ])
    for (const build of [buildCityModel, buildFarmModel]) {
      const before = build(a)
      const after = build(history)
      const empty = after.layout.plots[after.indexOf.get('empty.ts')!].rect
      expect(empty.w).toBeGreaterThan(0)
      expect(empty.h).toBeGreaterThan(0)
      expect(after.layout).toEqual(before.layout)
    }

    const city = buildCityModel(history)
    const farm = buildFarmModel(history)
    const cityHeight = (index: number) =>
      snapshotTargets(city, materializeSnapshot(history, index), 'language').heights[
        city.indexOf.get('source.ts')!
      ]
    const farmHeight = (index: number) =>
      farmTargets(farm, materializeSnapshot(history, index), 'language').heights[
        farm.indexOf.get('source.ts')!
      ]
    expect(cityHeight(0)).toBeCloseTo(6.4)
    expect(cityHeight(1)).toBeCloseTo(3.2)
    expect(cityHeight(2)).toBe(0)
    expect(farmHeight(1)).toBeLessThan(farmHeight(0))
    expect(farmHeight(2)).toBe(0)
  })
})
