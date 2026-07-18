import { describe, expect, it } from 'vitest'
import { buildRoadGraph } from './roads'
import { cityLayout, type RoadSegment } from './treemap'

const seg = (partial: Partial<RoadSegment> & Pick<RoadSegment, 'axis' | 'x' | 'z' | 'length'>) => ({
  width: 1,
  depth: 0,
  ...partial
})

describe('buildRoadGraph', () => {
  it('returns an empty graph for no segments', () => {
    const g = buildRoadGraph([])
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.adjacency).toEqual([])
  })

  it('turns a single segment into one edge with two nodes', () => {
    const g = buildRoadGraph([seg({ axis: 'z', x: 0, z: -5, length: 10 })])
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0].length).toBeCloseTo(10)
    expect(g.adjacency[g.edges[0].a]).toContain(0)
    expect(g.adjacency[g.edges[0].b]).toContain(0)
  })

  it('splits two crossing segments at a shared node', () => {
    const g = buildRoadGraph([
      seg({ axis: 'z', x: 0, z: -5, length: 10 }),
      seg({ axis: 'x', x: -5, z: 0, length: 10 })
    ])
    // one crossing node + 4 endpoints = 5 nodes, each segment split in two = 4 edges
    expect(g.nodes).toHaveLength(5)
    expect(g.edges).toHaveLength(4)
    const center = g.nodes.findIndex((n) => Math.abs(n.x) < 1e-6 && Math.abs(n.z) < 1e-6)
    expect(center).toBeGreaterThanOrEqual(0)
    expect(g.adjacency[center]).toHaveLength(4)
  })

  it('snaps a tee stub that stops just short of the crossing street', () => {
    // vertical road ends 0.4 short of the horizontal centerline; combined
    // half-widths (1.0) exceed the gap, so it must snap into a T-junction.
    const g = buildRoadGraph([
      seg({ axis: 'x', x: -5, z: 0, length: 10 }),
      seg({ axis: 'z', x: 2, z: 0.4, length: 5 })
    ])
    const junction = g.nodes.findIndex((n) => Math.abs(n.x - 2) < 1e-6 && Math.abs(n.z) < 1e-6)
    expect(junction).toBeGreaterThanOrEqual(0)
    expect(g.adjacency[junction].length).toBe(3) // T: two halves of the avenue + the stub
  })

  it('keeps adjacency symmetric and edge references valid', () => {
    const { roads } = cityLayout(
      Array.from({ length: 40 }, (_, i) => ({
        path: `${['a', 'a/b', 'c'][i % 3]}/f${i}.ts`,
        weight: 10 + ((i * 13) % 200)
      })),
      120
    )
    const g = buildRoadGraph(roads)
    expect(g.edges.length).toBeGreaterThan(0)
    for (const [ei, e] of g.edges.entries()) {
      expect(e.a).toBeGreaterThanOrEqual(0)
      expect(e.b).toBeLessThan(g.nodes.length)
      expect(e.a).not.toBe(e.b)
      expect(e.length).toBeGreaterThan(0)
      expect(g.adjacency[e.a]).toContain(ei)
      expect(g.adjacency[e.b]).toContain(ei)
    }
    // every adjacency entry points back at an edge touching that node
    g.adjacency.forEach((list, ni) => {
      for (const ei of list) {
        expect([g.edges[ei].a, g.edges[ei].b]).toContain(ni)
      }
    })
  })

  it('is deterministic', () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `d${i % 4}/f${i}.ts`,
      weight: 5 + i
    }))
    const a = buildRoadGraph(cityLayout(files, 100).roads)
    const b = buildRoadGraph(cityLayout(files, 100).roads)
    expect(a).toEqual(b)
  })
})
