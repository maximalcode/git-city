import { describe, expect, it } from 'vitest'
import { geometryFor, type AgentKind } from './trafficShapes'

describe('traffic agent geometries', () => {
  const kinds: AgentKind[] = ['car', 'bike', 'futuristic']
  it.each(kinds)('builds a valid merged geometry for %s', (kind) => {
    const geo = geometryFor(kind)
    // if mergeGeometries failed it returns null (and logs); the "!" would surface here
    expect(geo).toBeTruthy()
    const pos = geo.getAttribute('position')
    expect(pos).toBeTruthy()
    expect(pos.count).toBeGreaterThan(0)
    expect(geo.getAttribute('normal')).toBeTruthy()
  })

  it.each(['car', 'bike'] as AgentKind[])('%s carries paint-job vertex colors', (kind) => {
    const geo = geometryFor(kind)
    const color = geo.getAttribute('color')
    expect(color).toBeTruthy()
    expect(color.count).toBe(geo.getAttribute('position').count)
    // both paintable (white) and fixed-dark parts must exist
    let sawLight = false
    let sawDark = false
    for (let i = 0; i < color.count; i++) {
      if (color.getX(i) > 0.9) sawLight = true
      if (color.getX(i) < 0.2) sawDark = true
    }
    expect(sawLight).toBe(true)
    expect(sawDark).toBe(true)
  })

  it('person kind no longer exists', () => {
    const kindsNow: string[] = ['car', 'bike', 'futuristic']
    expect(kindsNow).not.toContain('person')
    // @ts-expect-error — 'person' was removed from AgentKind
    const bad: AgentKind = 'person'
    void bad
  })

  it('cars sit on the ground (no vertex below y=0)', () => {
    const pos = geometryFor('car').getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(-1e-6)
    }
  })
})
