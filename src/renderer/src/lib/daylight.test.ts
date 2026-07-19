import { describe, it, expect } from 'vitest'
import { sunState } from './daylight'

describe('sunState', () => {
  const S = 100

  it('sun is highest at noon and below the horizon at midnight', () => {
    const noon = sunState(0.5, S)
    const midnight = sunState(0, S)
    expect(noon.position[1]).toBeGreaterThan(midnight.position[1])
    expect(noon.isNight).toBe(false)
    expect(midnight.isNight).toBe(true)
  })

  it('sun crosses from east at dawn to west at dusk', () => {
    const dawn = sunState(0.25, S)
    const dusk = sunState(0.75, S)
    expect(dawn.position[0]).toBeGreaterThan(0) // +X = east
    expect(dusk.position[0]).toBeLessThan(0) // −X = west
  })

  it('key + ambient light are brightest at noon, dim at night', () => {
    const noon = sunState(0.5, S)
    const midnight = sunState(0, S)
    expect(noon.keyFactor).toBeGreaterThan(midnight.keyFactor)
    expect(noon.ambientFactor).toBeGreaterThan(midnight.ambientFactor)
    expect(midnight.keyFactor).toBeGreaterThan(0) // never fully black
  })

  it('light is warmer near the horizon than at noon', () => {
    expect(sunState(0.3, S).warmth).toBeGreaterThan(sunState(0.5, S).warmth)
  })

  it('never drops the key light below the ground plane', () => {
    for (let t = 0; t <= 1; t += 0.1) {
      expect(sunState(t, S).position[1]).toBeGreaterThan(0)
    }
  })

  it('wraps out-of-range time values', () => {
    expect(sunState(1.5, S)).toEqual(sunState(0.5, S))
    expect(sunState(-0.5, S)).toEqual(sunState(0.5, S))
  })
})
