import { describe, expect, it } from 'vitest'
import { buildRoadGraph } from '../layout/roads'
import { cityLayout } from '../layout/treemap'
import { buildRoadGeometry, roadY } from './roadGeometry'

const files = Array.from({ length: 50 }, (_, i) => ({
  path: `${['src', 'src/core', 'lib', 'test'][i % 4]}/f${i}.ts`,
  weight: 5 + ((i * 41) % 300)
}))

describe('roadY', () => {
  it('puts ground-level roads just above the ground plane', () => {
    expect(roadY(0)).toBeCloseTo(0.004)
  })
  it('stacks with district plates (plate top = depth*0.09 + 0.06)', () => {
    expect(roadY(1)).toBeCloseTo(1 * 0.09 + 0.06 + 0.004)
    expect(roadY(3)).toBeCloseTo(3 * 0.09 + 0.06 + 0.004)
  })
})

describe('buildRoadGeometry', () => {
  const graph = buildRoadGraph(cityLayout(files, 140).roads)
  const geo = buildRoadGeometry(graph)

  it('produces a valid non-indexed triangle soup with uv + normal', () => {
    const pos = geo.getAttribute('position')
    expect(pos.count % 6).toBe(0) // 6 vertices per quad
    expect(pos.count).toBeGreaterThan(0)
    expect(geo.getAttribute('uv').count).toBe(pos.count)
    expect(geo.getAttribute('normal').count).toBe(pos.count)
    // all normals point straight up
    const nrm = geo.getAttribute('normal')
    for (let i = 0; i < nrm.count; i++) {
      expect(nrm.getY(i)).toBe(1)
    }
  })

  it('keeps every vertex y within the plate band', () => {
    const pos = geo.getAttribute('position')
    const maxDepth = Math.max(...graph.edges.map((e) => e.depth))
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(roadY(0) - 1e-6)
      expect(pos.getY(i)).toBeLessThanOrEqual(roadY(maxDepth) + 0.002 + 1e-6)
    }
  })

  it('spans v from 0 to 1 across street quads', () => {
    const uv = geo.getAttribute('uv')
    let sawV0 = false
    let sawV1 = false
    for (let i = 0; i < uv.count; i++) {
      if (uv.getY(i) === 0) sawV0 = true
      if (uv.getY(i) === 1) sawV1 = true
    }
    expect(sawV0).toBe(true)
    expect(sawV1).toBe(true)
  })

  it('handles an empty graph', () => {
    const empty = buildRoadGeometry(buildRoadGraph([]))
    expect(empty.getAttribute('position').count).toBe(0)
  })
})
