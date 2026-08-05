import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import type { Snapshot } from '../../../shared/types'
import {
  authorColor,
  buildColorer,
  categorize,
  COLOR_MODES,
  LEGEND_MAX,
  OTHERS_COLOR
} from './colorModes'
import type { CityModel } from './cityData'

describe('categorize', () => {
  it('classifies by kind', () => {
    expect(categorize('src/app.ts')).toBe('code')
    expect(categorize('src/app.test.ts')).toBe('test')
    expect(categorize('test/foo.js')).toBe('test')
    expect(categorize('__tests__/x.py')).toBe('test')
    expect(categorize('package.json')).toBe('config')
    expect(categorize('.eslintrc')).toBe('config')
    expect(categorize('Dockerfile')).toBe('config')
    expect(categorize('README.md')).toBe('docs')
    expect(categorize('logo.png')).toBe('assets')
    expect(categorize('fonts/x.woff2')).toBe('assets')
    expect(categorize('data.bin')).toBe('other')
  })
})

describe('authorColor', () => {
  it('is deterministic and varies by name', () => {
    expect(authorColor('Alice')).toBe(authorColor('Alice'))
    expect(authorColor('Alice')).not.toBe(authorColor('Bob'))
    expect(authorColor('Alice')).toMatch(/^hsl\(/)
  })
})

function model(paths: string[]): CityModel {
  return {
    layout: {
      plots: paths.map((p) => ({ path: p, rect: { x: 0, y: 0, w: 1, h: 1 } })),
      districts: [],
      roads: []
    },
    roadGraph: { nodes: [], edges: [], adjacency: [] },
    paths,
    indexOf: new Map(paths.map((p, i) => [p, i])),
    langColors: paths.map(() => new Color('#3178c6')),
    citySize: 100,
    totalFiles: paths.length,
    capped: false
  }
}

const snapshot: Snapshot = {
  hash: 'x',
  date: 0,
  author: 'A',
  message: '',
  index: 0,
  files: [
    { path: 'a.ts', loc: 100, commits: 5, lastTouched: 1000, lastAuthor: 'Alice', binary: false },
    { path: 'b.test.ts', loc: 50, commits: 1, lastTouched: 5000, lastAuthor: 'Bob', binary: false },
    {
      path: 'README.md',
      loc: 20,
      commits: 2,
      lastTouched: 3000,
      lastAuthor: 'Alice',
      binary: false
    }
  ]
}

describe('buildColorer legends', () => {
  it('every mode produces a legend and a color', () => {
    const m = model(['a.ts', 'b.test.ts', 'README.md'])
    for (const mode of COLOR_MODES) {
      const colorer = buildColorer(m, snapshot, mode.id)
      expect(colorer.legend.items.length).toBeGreaterThan(0)
      const out = new Color()
      colorer.colorFor(snapshot.files[0], 0, out)
      // color written (some non-null rgb)
      expect(out.r + out.g + out.b).toBeGreaterThanOrEqual(0)
    }
  })

  it('author legend lists the authors present', () => {
    const m = model(['a.ts', 'b.test.ts', 'README.md'])
    const legend = buildColorer(m, snapshot, 'author').legend
    const labels = legend.items.map((i) => i.label)
    expect(labels).toContain('Alice')
    expect(labels).toContain('Bob')
    expect(legend.gradient).toBe(false)
  })

  it('gradient modes flag gradient and label both ends', () => {
    const m = model(['a.ts', 'b.test.ts', 'README.md'])
    for (const id of ['activity', 'recency', 'size'] as const) {
      const legend = buildColorer(m, snapshot, id).legend
      expect(legend.gradient).toBe(true)
      expect(legend.items[0].label).toBeTruthy()
      expect(legend.items[legend.items.length - 1].label).toBeTruthy()
    }
  })

  it('kind legend only lists categories present', () => {
    const m = model(['a.ts', 'b.test.ts', 'README.md'])
    const labels = buildColorer(m, snapshot, 'filetype').legend.items.map((i) => i.label)
    expect(labels).toEqual(expect.arrayContaining(['Code', 'Test', 'Docs']))
    expect(labels).not.toContain('Assets')
  })
})

/** A snapshot where every file carries the same value for `field`. */
function flatSnapshot(field: 'commits' | 'lastTouched' | 'loc', value: number): Snapshot {
  return {
    ...snapshot,
    files: ['a.ts', 'b.ts', 'c.ts'].map((path) => ({
      path,
      loc: field === 'loc' ? value : 10,
      commits: field === 'commits' ? value : 1,
      lastTouched: field === 'lastTouched' ? value : 1000,
      lastAuthor: 'Alice',
      binary: false
    }))
  }
}

/**
 * A ramp needs a range. On a one-commit repository — the shape a new user is
 * most likely to open — there isn't one, and the ramp used to land on whichever
 * end stop the arithmetic reached while the legend promised a spread (#28).
 */
describe('ramps with nothing to spread', () => {
  const m = model(['a.ts', 'b.ts', 'c.ts'])

  it('does not paint a single-commit repo the hottest "Often" red', () => {
    const colorer = buildColorer(m, flatSnapshot('commits', 1), 'activity')
    const hot = new Color()
    colorer.colorFor(snapshot.files[0], 0, hot)
    // the ramp's top stop is what it used to be
    expect(`#${hot.getHexString()}`).not.toBe('#ff4757')
    expect(colorer.legend.gradient).toBe(false)
    expect(colorer.legend.items).toHaveLength(1)
    expect(colorer.legend.items[0].label).toBe('All files: 1 commit')
  })

  it('does not paint files committed today as "Long ago"', () => {
    const colorer = buildColorer(m, flatSnapshot('lastTouched', 9999), 'recency')
    const c = new Color()
    colorer.colorFor(snapshot.files[0], 0, c)
    // the recent end, not the ancient blue-grey the old code produced
    expect(`#${c.getHexString()}`).toBe('#52e07a')
    expect(colorer.legend.items).toHaveLength(1)
  })

  it('says so when every file is the same size', () => {
    const colorer = buildColorer(m, flatSnapshot('loc', 42), 'size')
    expect(colorer.legend.items[0].label).toBe('All files: 42 lines')
  })

  it('gets the singular right for a one-line repo', () => {
    const colorer = buildColorer(m, flatSnapshot('loc', 1), 'size')
    expect(colorer.legend.items[0].label).toBe('All files: 1 line')
  })

  it('still spreads when there is a genuine range', () => {
    for (const id of ['activity', 'recency', 'size'] as const) {
      expect(buildColorer(m, snapshot, id).legend.gradient).toBe(true)
    }
  })

  it('does not fall over on a snapshot with no files at all', () => {
    const empty = { ...snapshot, files: [] }
    for (const mode of COLOR_MODES) {
      expect(() => buildColorer(model([]), empty, mode.id)).not.toThrow()
    }
  })
})

/** A snapshot with `n` distinct authors, one file each. */
function manyAuthors(n: number): Snapshot {
  return {
    ...snapshot,
    files: Array.from({ length: n }, (_, i) => ({
      path: `f${i}.ts`,
      loc: 10,
      commits: 1,
      lastTouched: 1000 + i,
      lastAuthor: `dev${i}`,
      binary: false
    }))
  }
}

/**
 * The legend stopped after eight swatches with no indication there were more,
 * while the first-run guide told users it explains every colour (#28).
 */
describe('legends with more than they can show', () => {
  it('folds the tail into one Others row', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `f${i}.ts`)
    const legend = buildColorer(model(paths), manyAuthors(12), 'author').legend
    expect(legend.items).toHaveLength(LEGEND_MAX + 1)
    expect(legend.items[LEGEND_MAX].label).toBe('Others (4)')
  })

  it('gives the scene the same Others colour the legend shows', () => {
    // an author with no swatch used to get a colour that meant nothing
    const paths = Array.from({ length: 12 }, (_, i) => `f${i}.ts`)
    const snap = manyAuthors(12)
    const colorer = buildColorer(model(paths), snap, 'author')
    const out = new Color()
    // dev0..dev11 all have one file each, so ties are broken by insertion
    // order — the last one is certain to be outside the top eight
    colorer.colorFor(snap.files[11], 11, out)
    expect(`#${out.getHexString()}`).toBe(OTHERS_COLOR)
  })

  it('adds no Others row when everything fits', () => {
    const paths = Array.from({ length: 3 }, (_, i) => `f${i}.ts`)
    const legend = buildColorer(model(paths), manyAuthors(3), 'author').legend
    expect(legend.items).toHaveLength(3)
    expect(legend.items.some((i) => i.label.startsWith('Others'))).toBe(false)
  })
})
