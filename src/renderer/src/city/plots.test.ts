import { describe, expect, it } from 'vitest'
import type { RepoAnalysis } from '../../../shared/types'
import { buildAnalysis } from '../../../shared/snapshots'
import { buildFarmModel } from '../layout/farm'
import { buildCityModel } from './cityData'
import type { PlotSource } from './plots'

function analysis(): RepoAnalysis {
  const files = ['a.ts', 'b/c.ts', 'b/d.css', 'b/e/f.md'].map((path) => ({
    path,
    loc: 120,
    commits: 3,
    lastTouched: 0,
    lastAuthor: 'a',
    binary: false
  }))
  return buildAnalysis({ name: 'r', path: '/r', branch: 'main', commitCount: 1 }, [
    { hash: 'h0', date: 1_700_000_000_000, author: 'a', message: 'c0', index: 0, files }
  ])
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
})
