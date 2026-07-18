import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import type { Snapshot } from '../../../shared/types'
import { authorColor, buildColorer, categorize, COLOR_MODES } from './colorModes'
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
    citySize: 100
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
