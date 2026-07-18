import { describe, expect, it } from 'vitest'
import { cityLayout, squarify, type Rect, type RoadSegment } from './treemap'

const rectArea = (r: Rect): number => r.w * r.h

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - 1e-9 &&
  b.x < a.x + a.w - 1e-9 &&
  a.y < b.y + b.h - 1e-9 &&
  b.y < a.y + a.h - 1e-9

describe('squarify', () => {
  const rect: Rect = { x: 0, y: 0, w: 60, h: 40 }

  it('preserves total area and item proportions', () => {
    const items = [40, 30, 20, 10, 5, 5].map((w, i) => ({ weight: w, payload: i }))
    const out = squarify(items, rect)
    expect(out).toHaveLength(items.length)
    const total = out.reduce((a, o) => a + rectArea(o.rect), 0)
    expect(total).toBeCloseTo(60 * 40, 6)
    // each rect's area is proportional to its weight
    const scale = (60 * 40) / 110
    for (const o of out) {
      expect(rectArea(o.rect)).toBeCloseTo(items[o.payload].weight * scale, 6)
    }
  })

  it('produces non-overlapping rects inside the bounds', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ weight: 1 + (i % 7), payload: i }))
    const out = squarify(items, rect)
    for (const o of out) {
      expect(o.rect.x).toBeGreaterThanOrEqual(-1e-9)
      expect(o.rect.y).toBeGreaterThanOrEqual(-1e-9)
      expect(o.rect.x + o.rect.w).toBeLessThanOrEqual(60 + 1e-9)
      expect(o.rect.y + o.rect.h).toBeLessThanOrEqual(40 + 1e-9)
    }
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlaps(out[i].rect, out[j].rect)).toBe(false)
      }
    }
  })

  it('handles empty input and zero-size rects', () => {
    expect(squarify([], rect)).toEqual([])
    expect(squarify([{ weight: 1, payload: 0 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([])
  })
})

describe('cityLayout', () => {
  const files = [
    { path: 'src/index.ts', weight: 300 },
    { path: 'src/app.ts', weight: 200 },
    { path: 'src/util/helpers.ts', weight: 120 },
    { path: 'src/util/format.ts', weight: 80 },
    { path: 'test/app.test.ts', weight: 150 },
    { path: 'README.md', weight: 50 },
    { path: 'package.json', weight: 30 }
  ]

  it('creates one plot per file and a district per directory', () => {
    const { plots, districts } = cityLayout(files, 100)
    expect(plots).toHaveLength(files.length)
    expect(new Set(plots.map((p) => p.path))).toEqual(new Set(files.map((f) => f.path)))
    expect(new Set(districts.map((d) => d.path))).toEqual(new Set(['src', 'src/util', 'test']))
  })

  it('keeps every plot inside its city bounds', () => {
    const { plots } = cityLayout(files, 100)
    for (const p of plots) {
      expect(p.rect.x).toBeGreaterThanOrEqual(-50 - 1e-9)
      expect(p.rect.y).toBeGreaterThanOrEqual(-50 - 1e-9)
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(50 + 1e-9)
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(50 + 1e-9)
      expect(p.rect.w).toBeGreaterThan(0)
      expect(p.rect.h).toBeGreaterThan(0)
    }
  })

  it('gives more weight more area', () => {
    const { plots } = cityLayout(files, 100)
    const byPath = new Map(plots.map((p) => [p.path, rectArea(p.rect)]))
    expect(byPath.get('src/index.ts')!).toBeGreaterThan(byPath.get('src/app.ts')!)
    expect(byPath.get('src/app.ts')!).toBeGreaterThan(byPath.get('package.json')!)
  })

  it('survives a single-file repo and deep nesting', () => {
    expect(cityLayout([{ path: 'only.txt', weight: 1 }], 50).plots).toHaveLength(1)
    const deep = cityLayout([{ path: 'a/b/c/d/e/f/g.ts', weight: 10 }], 50)
    expect(deep.plots).toHaveLength(1)
    expect(deep.districts.length).toBe(6)
  })
})

describe('cityLayout roads', () => {
  const manyFiles = Array.from({ length: 60 }, (_, i) => ({
    path: `${['src', 'src/core', 'src/ui', 'test', 'docs'][i % 5]}/f${i}.ts`,
    weight: 5 + ((i * 37) % 400)
  }))

  const roadRect = (r: RoadSegment): Rect =>
    r.axis === 'z'
      ? { x: r.x - r.width / 2, y: r.z, w: r.width, h: r.length }
      : { x: r.x, y: r.z - r.width / 2, w: r.length, h: r.width }

  it('emits roads for any multi-file layout', () => {
    const { roads } = cityLayout(manyFiles, 140)
    expect(roads.length).toBeGreaterThan(10)
    for (const r of roads) {
      expect(r.length).toBeGreaterThan(0)
      expect(r.width).toBeGreaterThan(0)
      expect(r.depth).toBeGreaterThanOrEqual(0)
    }
  })

  it('never overlaps a building plot (load-bearing invariant)', () => {
    const { roads, plots } = cityLayout(manyFiles, 140)
    for (const road of roads) {
      const rr = roadRect(road)
      for (const p of plots) {
        expect(overlaps(rr, p.rect)).toBe(false)
      }
    }
  })

  it('keeps roads within the city bounds', () => {
    const { roads } = cityLayout(manyFiles, 140)
    for (const road of roads) {
      const rr = roadRect(road)
      expect(rr.x).toBeGreaterThanOrEqual(-70 - 1e-6)
      expect(rr.y).toBeGreaterThanOrEqual(-70 - 1e-6)
      expect(rr.x + rr.w).toBeLessThanOrEqual(70 + 1e-6)
      expect(rr.y + rr.h).toBeLessThanOrEqual(70 + 1e-6)
    }
  })

  it('is deterministic', () => {
    const a = cityLayout(manyFiles, 140)
    const b = cityLayout(manyFiles, 140)
    expect(a.roads).toEqual(b.roads)
  })

  it('emits no roads for a single-file repo', () => {
    expect(cityLayout([{ path: 'only.txt', weight: 1 }], 50).roads).toEqual([])
  })
})
