import { describe, expect, it } from 'vitest'
import { SHIP_CLASS, type ShipClass } from '../layout/fleet'
import { engineAnchors, shipGeometryFor } from './shipShapes'

const classes: [string, ShipClass][] = [
  ['fighter', SHIP_CLASS.fighter],
  ['freighter', SHIP_CLASS.freighter],
  ['capital', SHIP_CLASS.capital]
]

describe('ship geometries', () => {
  it.each(classes)('%s merges into a valid geometry with paint colors', (_name, cls) => {
    const geo = shipGeometryFor(cls)
    expect(geo).toBeTruthy()
    const pos = geo.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    expect(geo.getAttribute('normal')).toBeTruthy()
    const color = geo.getAttribute('color')
    expect(color.count).toBe(pos.count)
    let sawLight = false
    let sawDark = false
    for (let i = 0; i < color.count; i++) {
      if (color.getX(i) > 0.9) sawLight = true
      if (color.getX(i) < 0.2) sawDark = true
    }
    expect(sawLight).toBe(true) // hull takes the color-mode paint
    expect(sawDark).toBe(true) // canopy/bridge stays dark
  })

  it('caches per class (same instance back)', () => {
    expect(shipGeometryFor(SHIP_CLASS.fighter)).toBe(shipGeometryFor(SHIP_CLASS.fighter))
  })

  it.each(classes)('%s exposes at least one engine anchor at the tail', (_name, cls) => {
    const anchors = engineAnchors(cls)
    expect(anchors.length).toBeGreaterThan(0)
    for (const [x] of anchors) {
      expect(x).toBeLessThan(0) // engines are at the back (nose faces +X)
    }
  })

  it('capital ships are the largest silhouette', () => {
    const spanX = (cls: ShipClass): number => {
      const pos = shipGeometryFor(cls).getAttribute('position')
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < pos.count; i++) {
        min = Math.min(min, pos.getX(i))
        max = Math.max(max, pos.getX(i))
      }
      return max - min
    }
    expect(spanX(SHIP_CLASS.capital)).toBeGreaterThan(spanX(SHIP_CLASS.freighter))
    expect(spanX(SHIP_CLASS.freighter)).toBeGreaterThan(spanX(SHIP_CLASS.fighter))
  })
})
