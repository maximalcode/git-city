/**
 * Time-of-day → sun placement, decoupled from the visual theme. A single slider
 * (0 = midnight, 0.25 = sunrise in the east, 0.5 = noon overhead, 0.75 = sunset
 * in the west, 1 = midnight again) drives the directional light's position and a
 * few brightness factors the scenes multiply onto their theme values. The theme
 * still owns colour and mood; daylight only moves the sun and dims the night, so
 * the two compose instead of fighting.
 */
export interface SunState {
  /** directional (key) light position, already scaled to the scene size */
  position: [number, number, number]
  /** multiply the theme's key-light intensity by this (≈1 at noon, a dim floor at night) */
  keyFactor: number
  /** multiply hemisphere/ambient intensity by this (never fully black) */
  ambientFactor: number
  /** 0 at high noon → 1 near the horizon; scenes may warm the light toward sunrise/sunset */
  warmth: number
  /** true while the sun sits below the horizon (night) */
  isNight: boolean
}

/** Wrap any real number into [0, 1). */
function wrap01(x: number): number {
  return ((x % 1) + 1) % 1
}

export function sunState(timeOfDay: number, size: number): SunState {
  const t = wrap01(timeOfDay)
  // arc angle: sunrise(0.25)→0, noon(0.5)→π/2, sunset(0.75)→π, midnight→±π/2 below
  const arc = (t - 0.25) * 2 * Math.PI
  const elevation = Math.sin(arc) // +1 overhead, 0 at horizon, −1 straight down
  const eastWest = Math.cos(arc) // +1 east (dawn), 0 overhead, −1 west (dusk)

  // keep the light physically above the ground so shadows read even at night
  const up = Math.max(elevation, 0.08)
  const position: [number, number, number] = [eastWest * size * 0.9, up * size * 1.15, size * 0.4]

  const day = Math.max(0, elevation)
  const keyFactor = 0.18 + 0.82 * day
  const ambientFactor = 0.4 + 0.6 * day
  const warmth = day > 0 ? Math.min(1, 1 - elevation / 0.5) : 1

  return { position, keyFactor, ambientFactor, warmth, isNight: elevation < 0 }
}
