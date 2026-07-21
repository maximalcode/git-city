import { describe, expect, it } from 'vitest'
import { buildRoadGraph } from '../layout/roads'
import { cityLayout } from '../layout/treemap'
import { junctionHalfSizes } from './roadGeometry'
import { buildStreetDetail, CAR_HALF_WIDTH, LANE_OFFSET_CAP, PARK_MIN_WIDTH } from './streetFurniture'

const files = Array.from({ length: 120 }, (_, i) => ({
  path: `${['src', 'src/core', 'src/ui', 'lib', 'test', 'docs'][i % 6]}/f${i}.ts`,
  weight: 5 + ((i * 41) % 400)
}))

const graph = buildRoadGraph(cityLayout(files, 140).roads)
const detail = buildStreetDetail(graph, 1)

/** true if (x,z) lies on edge `e` within `pad` of its carriageway */
function onEdge(x: number, z: number, minWidth = 0): boolean {
  return graph.edges.some((e) => {
    if (e.width < minWidth) return false
    const na = graph.nodes[e.a]
    const nb = graph.nodes[e.b]
    const half = e.width / 2 + 1e-6
    if (e.axis === 'x') {
      return (
        Math.abs(z - na.z) <= half &&
        x >= Math.min(na.x, nb.x) - 1e-6 &&
        x <= Math.max(na.x, nb.x) + 1e-6
      )
    }
    return (
      Math.abs(x - na.x) <= half &&
      z >= Math.min(na.z, nb.z) - 1e-6 &&
      z <= Math.max(na.z, nb.z) + 1e-6
    )
  })
}

describe('buildStreetDetail', () => {
  it('is deterministic', () => {
    const again = buildStreetDetail(graph, 1)
    expect(again).toEqual(detail)
  })

  it('places parked cars only on wide-enough streets, inside the carriageway', () => {
    expect(detail.parked.length).toBeGreaterThan(0)
    for (const p of detail.parked) {
      expect(onEdge(p.x, p.z, PARK_MIN_WIDTH)).toBe(true)
    }
  })

  it('keeps parked cars clear of the driving lane', () => {
    for (const p of detail.parked) {
      // find the edge this car parks on and check its lateral offset
      const e = graph.edges.find((e) => {
        if (e.width < PARK_MIN_WIDTH) return false
        const na = graph.nodes[e.a]
        return e.axis === 'x' ? Math.abs(p.z - na.z) <= e.width / 2 : Math.abs(p.x - na.x) <= e.width / 2
      })!
      const na = graph.nodes[e.a]
      const off = e.axis === 'x' ? Math.abs(p.z - na.z) : Math.abs(p.x - na.x)
      // the parked body stays clear of the moving lane's outer edge
      const laneEdge = Math.min(e.width * 0.22, LANE_OFFSET_CAP) + CAR_HALF_WIDTH
      expect(off - CAR_HALF_WIDTH).toBeGreaterThan(laneEdge)
    }
  })

  it('puts stop lines only near junction nodes', () => {
    const jHalf = junctionHalfSizes(graph)
    expect(detail.stopLines.length).toBeGreaterThan(0)
    for (const s of detail.stopLines) {
      const near = graph.nodes.some(
        (n, ni) =>
          jHalf[ni] !== null &&
          Math.abs(n.x - s.x) < jHalf[ni]! + 2 &&
          Math.abs(n.z - s.z) < jHalf[ni]! + 2
      )
      expect(near).toBe(true)
    }
  })

  it('keeps manholes on the road surface', () => {
    expect(detail.manholes.length).toBeGreaterThan(0)
    for (const m of detail.manholes) {
      expect(onEdge(m.x, m.z)).toBe(true)
    }
  })

  it('pairs traffic lights on diagonal corners of big junctions', () => {
    expect(detail.lights.length % 2).toBe(0)
    for (const l of detail.lights) {
      expect(l.phase === 0 || l.phase === 1).toBe(true)
    }
  })

  it('handles an empty graph', () => {
    const empty = buildStreetDetail(buildRoadGraph([]), 1)
    expect(empty.parked).toEqual([])
    expect(empty.stopLines).toEqual([])
    expect(empty.manholes).toEqual([])
    expect(empty.lights).toEqual([])
  })
})
