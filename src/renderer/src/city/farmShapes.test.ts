import { describe, expect, it } from 'vitest'
import { tractorCount, tractorGeometry } from './farmShapes'

/**
 * How busy the tracks get. The city runs 0.4 agents per street segment; a farm
 * at that density reads as a depot rather than a farm, so this is a twentieth
 * of it — the point is that the tracks are *used*, not busy (#52).
 */
describe('tractorCount', () => {
  it('leaves a tiny holding empty rather than putting a tractor on two tracks', () => {
    expect(tractorCount(0)).toBe(0)
    expect(tractorCount(3)).toBe(0)
  })

  it('puts at least one on a holding that has tracks worth driving', () => {
    expect(tractorCount(10)).toBeGreaterThanOrEqual(1)
  })

  it('stays far below the city, which would run hundreds at this size', () => {
    // 2,000 segments: the city would field 80 agents here
    expect(tractorCount(2_000)).toBeLessThanOrEqual(12)
  })

  it('is capped, so a monorepo does not field a fleet', () => {
    expect(tractorCount(17_625)).toBe(12)
    expect(tractorCount(1_000_000)).toBe(12)
  })

  it('grows with the holding, up to the cap', () => {
    expect(tractorCount(500)).toBeGreaterThan(tractorCount(50))
  })
})

describe('tractorGeometry', () => {
  it('builds one merged geometry with baked colours', () => {
    const g = tractorGeometry()
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    // vertex colours, because one instanced mesh draws every tractor
    expect(g.getAttribute('color')).toBeTruthy()
    g.dispose()
  })

  it('sits on the ground and faces +X, like every other farm prop', () => {
    const g = tractorGeometry()
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.y).toBeCloseTo(0, 1)
    // longer along X than Z — it points the way it drives
    expect(bb.max.x - bb.min.x).toBeGreaterThan(bb.max.z - bb.min.z)
    g.dispose()
  })
})
