import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_ID,
  UNLIT_WORLD_FLOOR,
  getTheme,
  lightBoost,
  lightBudget,
  THEMES
} from './themes'

describe('theme registry', () => {
  it('exposes the four aesthetics + realistic day/night', () => {
    const ids = THEMES.map((t) => t.id)
    expect(ids).toEqual(['realistic-day', 'realistic-night', 'neon', 'golden-hour', 'midnight-ink'])
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
      expect(t.road.surface).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.road.marking).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.road.markingEmissive).toBeGreaterThanOrEqual(0)
      expect(typeof t.shopfront.enabled).toBe('boolean')
      expect(t.shopfront.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.shopfront.intensity).toBeGreaterThanOrEqual(0)
      expect(t.grass).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.soil).toMatch(/^#[0-9a-f]{6}$/i)
      expect(typeof t.farmLights.enabled).toBe('boolean')
      expect(t.farmLights.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.farmLights.intensity).toBeGreaterThanOrEqual(0)
    }
  })

  /**
   * The farm's night language mirrors the city's: the themes that make their
   * light budget up in emissive geometry must give the farm some too, or it
   * stays a dim field of rectangles while the city glows (#22).
   */
  it('every theme that lights the city also lights the farm', () => {
    for (const t of THEMES) {
      expect(t.farmLights.enabled, t.id).toBe(t.windows.enabled)
      if (t.farmLights.enabled) expect(t.farmLights.intensity, t.id).toBeGreaterThan(0)
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

  /**
   * The farm has no lit windows to carry a dark theme, so it boosts dim themes
   * to a floor. These pin the property that made that necessary — and catch a
   * new theme that is too dark for a world without emissive geometry.
   */
  describe('light budget', () => {
    it('lifts every theme to the floor for a world that does not glow', () => {
      for (const t of THEMES) {
        const boosted = lightBudget(t) * lightBoost(t, UNLIT_WORLD_FLOOR)
        expect(boosted).toBeGreaterThanOrEqual(UNLIT_WORLD_FLOOR - 1e-9)
      }
    })

    it('leaves a theme that is already bright enough untouched', () => {
      // Daylight carries the farm on its own; boosting it would blow it out
      expect(lightBoost(getTheme('realistic-day'), UNLIT_WORLD_FLOOR)).toBe(1)
      // Night is the default, and is the one that went black
      expect(lightBoost(getTheme('realistic-night'), UNLIT_WORLD_FLOOR)).toBeGreaterThan(2)
    })

    it('keeps night dimmer than day after boosting', () => {
      // the floor must not flatten the themes into each other
      const day = lightBudget(getTheme('realistic-day'))
      const night =
        lightBudget(getTheme('realistic-night')) *
        lightBoost(getTheme('realistic-night'), UNLIT_WORLD_FLOOR)
      expect(night).toBeLessThan(day)
    })
  })
})
