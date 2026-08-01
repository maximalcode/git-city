/**
 * Visual theme registry. Everything the city's look used to hard-code behind a
 * `night` boolean now lives here as data, so adding a look = adding an entry.
 *
 * Fields consumed progressively across v3 milestones:
 *  - M1 (now): colors, lights, fog, bloom, vignette, building material, district colors
 *  - M2: windows (night glow), sky (gradient dome), ao (ambient occlusion)
 *  - M3: lowPoly (geometry + flat shading), lerpSpeed (bounce)
 *  - M4: particles (ambiance)
 */
export interface Theme {
  id: string
  name: string
  /** short glyph shown on the theme button */
  glyph: string
  background: string
  /** fog start/end as multiples of citySize */
  fog: { near: number; far: number }
  hemisphere: { sky: string; ground: string; intensity: number }
  dirMain: { color: string; intensity: number }
  dirFill: { color: string; intensity: number }
  ground: string
  bloom: { threshold: number; intensity: number }
  vignette: number
  building: { roughness: number; metalness: number; colorVariation: number }

  // --- M2 ---
  windows: { enabled: boolean; color: string; intensity: number }
  sky: 'flat' | 'gradient'
  skyTop: string
  skyBottom: string
  ao: boolean

  // --- M3 ---
  lowPoly: boolean
  /** building rise/settle speed; higher = snappier/bouncier */
  lerpSpeed: number
  districtBase: string
  label: string

  // --- M4 ---
  particles: 'none' | 'motes' | 'rain' | 'confetti'

  // --- v4 ---
  /** street surfaces; markingEmissive > 0 adds a bloom-boosted marking overlay.
   *  `sidewalk` colours the raised curb slabs flanking every road. */
  road: { surface: string; marking: string; markingEmissive: number; sidewalk: string }
  /** ground-floor shop windows + signage on tall buildings */
  shopfront: { enabled: boolean; color: string; intensity: number }
  /**
   * Ground tone for the non-city worlds — trees stand on green whatever the sky
   * is doing. Lives here rather than in a per-mode map so a new world mode adds
   * a theme knob instead of another parallel palette table.
   */
  grass: string
  /** tilled earth under the crop in the farm view */
  soil: string
}

export const THEMES: Theme[] = [
  {
    id: 'realistic-day',
    name: 'Daylight',
    glyph: '☀',
    background: '#0e1420',
    fog: { near: 1.6, far: 6 },
    hemisphere: { sky: '#bcd4ff', ground: '#2a2418', intensity: 0.9 },
    dirMain: { color: '#ffe3b8', intensity: 1.8 },
    dirFill: { color: '#a8c8ff', intensity: 0.6 },
    ground: '#151c2b',
    bloom: { threshold: 0.9, intensity: 0.45 },
    vignette: 0.45,
    building: { roughness: 0.55, metalness: 0.15, colorVariation: 0.06 },
    windows: { enabled: false, color: '#ffd27a', intensity: 0 },
    sky: 'gradient',
    skyTop: '#3d6bb0',
    skyBottom: '#b8cfe8',
    ao: true,
    lowPoly: false,
    lerpSpeed: 5,
    districtBase: '#232c3d',
    label: 'rgba(255, 255, 255, 0.65)',
    particles: 'motes',
    road: { surface: '#2a3140', marking: '#c8cede', markingEmissive: 0, sidewalk: '#68718a' },
    shopfront: { enabled: false, color: '#ffd9a0', intensity: 0 },
    grass: '#3f6b30',
    soil: '#5a4227'
  },
  {
    id: 'realistic-night',
    name: 'Night',
    glyph: '☾',
    background: '#070a12',
    fog: { near: 1.6, far: 6 },
    hemisphere: { sky: '#3a4a7a', ground: '#0a0c14', intensity: 0.35 },
    dirMain: { color: '#8fa8ff', intensity: 0.5 },
    dirFill: { color: '#4a5a9a', intensity: 0.15 },
    ground: '#0a0e18',
    bloom: { threshold: 0.9, intensity: 0.9 },
    vignette: 0.65,
    building: { roughness: 0.5, metalness: 0.2, colorVariation: 0.05 },
    windows: { enabled: true, color: '#ffd27a', intensity: 2.2 },
    sky: 'gradient',
    skyTop: '#05070f',
    skyBottom: '#16233f',
    ao: true,
    lowPoly: false,
    lerpSpeed: 5,
    districtBase: '#141a26',
    label: 'rgba(220, 230, 255, 0.5)',
    particles: 'motes',
    road: { surface: '#10141e', marking: '#8f97ad', markingEmissive: 0, sidewalk: '#2b3242' },
    shopfront: { enabled: true, color: '#ffd9a0', intensity: 1.6 },
    grass: '#16271a',
    soil: '#2a2018'
  },
  {
    id: 'neon',
    name: 'Neon',
    glyph: '⚡',
    background: '#05010f',
    fog: { near: 1.3, far: 5 },
    hemisphere: { sky: '#2a1a5a', ground: '#0a0518', intensity: 0.4 },
    dirMain: { color: '#ff4da6', intensity: 0.6 },
    dirFill: { color: '#4de1ff', intensity: 0.5 },
    ground: '#0a0420',
    bloom: { threshold: 0.55, intensity: 1.6 },
    vignette: 0.7,
    building: { roughness: 0.3, metalness: 0.4, colorVariation: 0.12 },
    windows: { enabled: true, color: '#4de1ff', intensity: 3 },
    sky: 'gradient',
    skyTop: '#0a0326',
    skyBottom: '#3a1060',
    ao: false,
    lowPoly: false,
    lerpSpeed: 6,
    districtBase: '#160a33',
    label: 'rgba(120, 230, 255, 0.7)',
    particles: 'rain',
    road: { surface: '#0c0622', marking: '#4de1ff', markingEmissive: 1.6, sidewalk: '#241a4a' },
    shopfront: { enabled: true, color: '#ff4da6', intensity: 2.6 },
    grass: '#122436',
    soil: '#1d2233'
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    glyph: '☼',
    background: '#1c1020',
    fog: { near: 1.8, far: 6.5 },
    hemisphere: { sky: '#ffd9a0', ground: '#3a2818', intensity: 0.6 },
    dirMain: { color: '#ff9d5c', intensity: 1.8 },
    dirFill: { color: '#a86fff', intensity: 0.3 },
    ground: '#241826',
    bloom: { threshold: 0.82, intensity: 0.65 },
    vignette: 0.5,
    building: { roughness: 0.55, metalness: 0.2, colorVariation: 0.09 },
    windows: { enabled: true, color: '#ffcf8a', intensity: 1.5 },
    sky: 'gradient',
    skyTop: '#3a2352',
    skyBottom: '#ff9e5a',
    ao: true,
    lowPoly: false,
    lerpSpeed: 5,
    districtBase: '#2a1c2e',
    label: 'rgba(255, 224, 190, 0.6)',
    particles: 'motes',
    road: { surface: '#2c2030', marking: '#e8c8a0', markingEmissive: 0, sidewalk: '#4c3b48' },
    shopfront: { enabled: true, color: '#ffcf8a', intensity: 1.2 },
    grass: '#4a5326',
    soil: '#5b3f1f'
  },
  {
    id: 'midnight-ink',
    name: 'Midnight Ink',
    glyph: '✦',
    background: '#080a10',
    fog: { near: 1.7, far: 6 },
    hemisphere: { sky: '#4a5470', ground: '#0a0c12', intensity: 0.4 },
    dirMain: { color: '#cdd6f0', intensity: 0.95 },
    dirFill: { color: '#5566aa', intensity: 0.22 },
    ground: '#0a0c14',
    bloom: { threshold: 0.8, intensity: 0.75 },
    vignette: 0.6,
    building: { roughness: 0.35, metalness: 0.5, colorVariation: 0.05 },
    windows: { enabled: true, color: '#8fb0ff', intensity: 1.8 },
    sky: 'gradient',
    skyTop: '#05060a',
    skyBottom: '#141a2c',
    ao: true,
    lowPoly: false,
    lerpSpeed: 5,
    districtBase: '#0e1119',
    label: 'rgba(180, 195, 235, 0.55)',
    particles: 'motes',
    road: { surface: '#0c0f16', marking: '#7d8cb8', markingEmissive: 0.4, sidewalk: '#232838' },
    shopfront: { enabled: true, color: '#8fb0ff', intensity: 1.4 },
    grass: '#141f18',
    soil: '#221d1a'
  }
]

export const DEFAULT_THEME_ID = 'realistic-night'

export function getTheme(id: string | undefined): Theme {
  return (
    THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? THEMES[0]
  )
}
