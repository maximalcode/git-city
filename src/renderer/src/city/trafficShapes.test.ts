import { describe, expect, it } from 'vitest'
import { geometryFor, type AgentKind } from './trafficShapes'

describe('traffic agent geometries', () => {
  const kinds: AgentKind[] = ['car', 'person', 'bike', 'futuristic']
  it.each(kinds)('builds a valid merged geometry for %s', (kind) => {
    const geo = geometryFor(kind)
    // if mergeGeometries failed it returns null (and logs); the "!" would surface here
    expect(geo).toBeTruthy()
    const pos = geo.getAttribute('position')
    expect(pos).toBeTruthy()
    expect(pos.count).toBeGreaterThan(0)
    expect(geo.getAttribute('normal')).toBeTruthy()
  })
})
