import { describe, expect, it } from 'vitest'
import type { RepoAnalysis } from '../../../shared/types'
import { buildAnalysis, materializeSnapshot } from '../../../shared/snapshots'
import { buildFarmModel, cropHeightFor, cropKindFor, farmTargets, CROP_KINDS } from './farm'

function file(path: string, loc: number) {
  return { path, loc, commits: 1, lastTouched: 0, lastAuthor: 'a', binary: false }
}

function analysis(snapshots: { files: ReturnType<typeof file>[] }[]): RepoAnalysis {
  return buildAnalysis(
    { name: 'r', path: '/r', branch: 'main', commitCount: snapshots.length },
    snapshots.map((s, i) => ({
      hash: `h${i}`,
      date: 1_700_000_000_000 + i * 1000,
      author: 'a',
      message: `c${i}`,
      index: i,
      files: s.files
    }))
  )
}

describe('cropKindFor', () => {
  it('grades a file into a crop class by peak size', () => {
    expect(cropKindFor(1)).toBe('furrow')
    expect(cropKindFor(119)).toBe('furrow')
    expect(cropKindFor(120)).toBe('row')
    expect(cropKindFor(1199)).toBe('row')
    expect(cropKindFor(1200)).toBe('orchard')
    expect(cropKindFor(50_000)).toBe('orchard')
  })
})

describe('cropHeightFor', () => {
  it('grows with line count but compresses the top end', () => {
    expect(cropHeightFor(10)).toBeLessThan(cropHeightFor(1000))
    expect(cropHeightFor(1000)).toBeLessThan(cropHeightFor(100_000))
    // a 100k-line file must not tower a hundred times over a 1k one
    expect(cropHeightFor(100_000) / cropHeightFor(1000)).toBeLessThan(4)
  })

  it('stays within a plantable range', () => {
    for (const loc of [0, 1, 42, 5_000, 10_000_000]) {
      expect(cropHeightFor(loc)).toBeGreaterThan(0)
      expect(cropHeightFor(loc)).toBeLessThanOrEqual(3.2)
    }
  })
})

describe('buildFarmModel', () => {
  const a = analysis([
    { files: [file('src/a.ts', 100), file('src/b.ts', 50)] },
    {
      files: [
        file('src/a.ts', 400),
        file('src/b.ts', 50),
        file('docs/c.md', 20),
        file('docs/deep/d.md', 5000)
      ]
    }
  ])

  it('covers every file that ever existed, not just the head snapshot', () => {
    const m = buildFarmModel(a)
    expect(m.paths.sort()).toEqual(['docs/c.md', 'docs/deep/d.md', 'src/a.ts', 'src/b.ts'])
    expect(m.rects.length).toBe(m.paths.length)
    expect(m.centers.length).toBe(m.paths.length * 2)
  })

  it('sizes fields from peak line count, so a shrinking file keeps its plot', () => {
    const m = buildFarmModel(a)
    const big = m.indexOf.get('docs/deep/d.md')!
    const small = m.indexOf.get('docs/c.md')!
    const area = (i: number) => m.rects[i].w * m.rects[i].h
    expect(area(big)).toBeGreaterThan(area(small))
  })

  it('gives fields that never overlap', () => {
    const m = buildFarmModel(a)
    for (let i = 0; i < m.rects.length; i++) {
      for (let j = i + 1; j < m.rects.length; j++) {
        const p = m.rects[i]
        const q = m.rects[j]
        const disjoint =
          p.x + p.w <= q.x + 1e-6 ||
          q.x + q.w <= p.x + 1e-6 ||
          p.y + p.h <= q.y + 1e-6 ||
          q.y + q.h <= p.y + 1e-6
        expect(disjoint).toBe(true)
      }
    }
  })

  it('groups fields into parcels by directory', () => {
    const m = buildFarmModel(a)
    const parcel = (p: string) => m.parcelOf[m.indexOf.get(p)!]
    expect(parcel('src/a.ts')).toBe(parcel('src/b.ts'))
    expect(parcel('src/a.ts')).not.toBe(parcel('docs/c.md'))
    // a nested directory is its own parcel
    expect(parcel('docs/deep/d.md')).not.toBe(parcel('docs/c.md'))
  })

  it('assigns a crop class to every field', () => {
    const m = buildFarmModel(a)
    for (let i = 0; i < m.paths.length; i++) {
      expect(m.kinds[i]).toBeGreaterThanOrEqual(0)
      expect(m.kinds[i]).toBeLessThan(CROP_KINDS.length)
    }
  })

  it('lays out an empty repository without throwing', () => {
    const m = buildFarmModel(analysis([{ files: [] }]))
    expect(m.paths).toEqual([])
    expect(m.worldSize).toBeGreaterThan(0)
    expect(m.steads).toEqual([])
  })
})

describe('farmTargets', () => {
  const a = analysis([
    { files: [file('src/a.ts', 100)] },
    { files: [file('src/a.ts', 900), file('src/b.ts', 40)] }
  ])
  const model = buildFarmModel(a)

  it('leaves a field bare until its file exists', () => {
    const first = farmTargets(model, materializeSnapshot(a, 0), 'language')
    const b = model.indexOf.get('src/b.ts')!
    expect(first.heights[b]).toBe(0)
  })

  it('raises the crop once the file appears, and with its size', () => {
    const first = farmTargets(model, materializeSnapshot(a, 0), 'language')
    const second = farmTargets(model, materializeSnapshot(a, 1), 'language')
    const idx = model.indexOf.get('src/a.ts')!
    expect(second.heights[idx]).toBeGreaterThan(first.heights[idx])
    expect(second.heights[model.indexOf.get('src/b.ts')!]).toBeGreaterThan(0)
  })

  it('emits one rgb triplet per field', () => {
    const t = farmTargets(model, materializeSnapshot(a, 1), 'language')
    expect(t.colors.length).toBe(model.paths.length * 3)
    for (const v of t.colors) expect(v).toBeGreaterThanOrEqual(0)
  })
})
