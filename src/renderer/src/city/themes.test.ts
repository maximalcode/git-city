import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, getTheme, THEMES } from './themes'

describe('theme registry', () => {
  it('exposes the four aesthetics + realistic day/night', () => {
    const ids = THEMES.map((t) => t.id)
    expect(ids).toEqual([
      'realistic-day',
      'realistic-night',
      'neon',
      'golden-hour',
      'midnight-ink'
    ])
  })

  it('has unique ids', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every theme is fully specified (no missing knobs)', () => {
    for (const t of THEMES) {
      expect(t.name).toBeTruthy()
      expect(t.glyph).toBeTruthy()
      expect(t.background).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.ground).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.fog.near).toBeGreaterThan(0)
      expect(t.fog.far).toBeGreaterThan(t.fog.near)
      expect(t.hemisphere.intensity).toBeGreaterThanOrEqual(0)
      expect(t.bloom.threshold).toBeGreaterThanOrEqual(0)
      expect(t.bloom.intensity).toBeGreaterThanOrEqual(0)
      expect(t.building.roughness).toBeGreaterThanOrEqual(0)
      expect(t.lerpSpeed).toBeGreaterThan(0)
      expect(['flat', 'gradient']).toContain(t.sky)
      expect(['none', 'motes', 'rain', 'confetti']).toContain(t.particles)
      expect(typeof t.lowPoly).toBe('boolean')
      expect(typeof t.windows.enabled).toBe('boolean')
    }
  })

  it('getTheme resolves by id and falls back to the default', () => {
    expect(getTheme('neon').id).toBe('neon')
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID)
    expect(getTheme('does-not-exist').id).toBe(DEFAULT_THEME_ID)
  })

  it('default theme id exists in the registry', () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME_ID)).toBe(true)
  })
})
