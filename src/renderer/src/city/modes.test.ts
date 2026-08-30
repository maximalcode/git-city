import { describe, expect, it } from 'vitest'
import type { RepoAnalysis } from '../../../shared/types'
import { buildAnalysis, materializeSnapshot } from '../../../shared/snapshots'
import { DEFAULT_MODE, MODES, getMode, isViewMode, nextMode, type PreparedScene } from './modes'

/** One snapshot per frame; each frame is the files and their sizes at it. */
function analysisFrom(frames: { path: string; loc: number }[][]): RepoAnalysis {
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
        commits: 1,
        lastTouched: 0,
        lastAuthor: 'a',
        binary: false
      }))
    }))
  )
}

const THREE_FILES = [
  { path: 'a.ts', loc: 100 },
  { path: 'b/c.ts', loc: 100 },
  { path: 'b/d.css', loc: 100 }
]

function analysis(): RepoAnalysis {
  return analysisFrom([THREE_FILES])
}

/**
 * The registry replaced a per-mode ternary repeated across the shell, so
 * these guard the properties that made that removal safe: every mode is fully
 * specified, lookups never return undefined, and cycling covers all of them
 * rather than flipping between two.
 */

describe('mode registry', () => {
  it('fully specifies every mode', () => {
    expect(MODES.length).toBeGreaterThanOrEqual(2)
    for (const m of MODES) {
      expect(m.id).toBeTruthy()
      expect(m.name).toBeTruthy()
      expect(m.glyph).toBeTruthy()
      expect(m.hint).toBeTruthy()
      expect(m.noun).toBeTruthy()
      expect(typeof m.ao).toBe('boolean')
      expect(typeof m.prepare).toBe('function')
    }
  })

  it('has unique ids', () => {
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length)
  })

  it('gives every mode first-run rows including the colour legend', () => {
    for (const m of MODES) {
      const rows = m.rows('Activity')
      expect(rows.length).toBeGreaterThanOrEqual(3)
      expect(rows.some((r) => r.title.toLowerCase().includes('activity'))).toBe(true)
      // every row must render: icon + copy
      for (const r of rows) {
        expect(r.icon).toBeTruthy()
        expect(r.title).toBeTruthy()
        expect(r.body).toBeTruthy()
      }
    }
  })

  it('resolves a known id and falls back for anything else', () => {
    expect(getMode('city').id).toBe('city')
    expect(getMode('farm').id).toBe('farm')
    // a mode removed in a later version must not strand the app
    expect(getMode('atlantis').id).toBe(MODES[0].id)
    expect(getMode('').id).toBe(MODES[0].id)
  })

  it('validates persisted values against the registry', () => {
    expect(isViewMode('city')).toBe(true)
    expect(isViewMode('farm')).toBe(true)
    // removed in a later version — must not validate
    expect(isViewMode('forest')).toBe(false)
    expect(isViewMode('atlantis')).toBe(false)
    expect(isViewMode(null)).toBe(false)
    expect(isViewMode(2)).toBe(false)
  })

  it('cycles through every mode and wraps', () => {
    let id = DEFAULT_MODE
    const seen = [id]
    for (let i = 0; i < MODES.length - 1; i++) {
      id = nextMode(id).id
      seen.push(id)
    }
    expect(new Set(seen).size).toBe(MODES.length)
    // one more step returns to the start
    expect(nextMode(id).id).toBe(DEFAULT_MODE)
  })

  it('defaults to a mode the registry knows', () => {
    expect(isViewMode(DEFAULT_MODE)).toBe(true)
  })

  /**
   * The minimap rebuilds its static base layer whenever the dot array changes
   * identity, so dots must be the same array across snapshots and colour modes —
   * they are positions and language colours, neither of which those affect.
   */
  it('hands back the same dot array for one analysis', () => {
    const a = analysis()
    const snapshot = materializeSnapshot(a, 0)
    for (const mode of MODES) {
      const first = mode.prepare(a, snapshot, 'language').dots()
      const again = mode.prepare(a, snapshot, 'activity').dots()
      expect(first.length).toBeGreaterThan(0)
      expect(again).toBe(first)
    }
  })
})

/**
 * Every mode goes through the layout-keyed model cache, so a commit that did
 * not move anything reuses the city it already had (#69). The cache's own
 * behaviour is tested in modelCache.test.ts; this is the wiring — that
 * `prepare` consults it at all, for every mode.
 *
 * Model identity is observable through dots(), which is memoised per model. The
 * scenes are held in locals across the assertion because the cache holds its
 * model weakly, exactly as a mounted SceneView holds it.
 */
describe('model reuse across analyses', () => {
  const sceneFor = (mode: (typeof MODES)[number], a: RepoAnalysis): PreparedScene =>
    mode.prepare(a, materializeSnapshot(a, a.snapshots.length - 1), 'language')

  it('keeps the model when a commit left every peak alone', () => {
    const one = analysisFrom([THREE_FILES])
    // a second commit in which all three files shrank: same peaks, new object
    const two = analysisFrom([THREE_FILES, THREE_FILES.map((f) => ({ ...f, loc: 5 }))])
    for (const mode of MODES) {
      const before = sceneFor(mode, one)
      const after = sceneFor(mode, two)
      expect(after.dots()).toBe(before.dots())
    }
  })

  it('rebuilds when a commit adds a file', () => {
    const one = analysisFrom([THREE_FILES])
    const two = analysisFrom([THREE_FILES, [...THREE_FILES, { path: 'new.ts', loc: 30 }]])
    for (const mode of MODES) {
      const before = sceneFor(mode, one)
      const after = sceneFor(mode, two)
      expect(after.dots()).not.toBe(before.dots())
    }
  })

  it('keeps each mode its own model, so switching back does not relayout', () => {
    const a = analysis()
    const city = sceneFor(MODES[0], a)
    const farm = sceneFor(MODES[1], a)
    expect(farm.dots()).not.toBe(city.dots())
    expect(sceneFor(MODES[0], a).dots()).toBe(city.dots())
  })
})
