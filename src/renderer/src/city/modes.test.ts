import { describe, expect, it } from 'vitest'
import { DEFAULT_MODE, MODES, getMode, isViewMode, nextMode } from './modes'

/**
 * The registry replaced a city-or-forest ternary repeated across the shell, so
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
    expect(getMode('forest').id).toBe('forest')
    expect(getMode('city').id).toBe('city')
    // a mode removed in a later version must not strand the app
    expect(getMode('farm').id).toBe(MODES[0].id)
    expect(getMode('').id).toBe(MODES[0].id)
  })

  it('validates persisted values against the registry', () => {
    expect(isViewMode('city')).toBe(true)
    expect(isViewMode('forest')).toBe(true)
    expect(isViewMode('farm')).toBe(false)
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
})
