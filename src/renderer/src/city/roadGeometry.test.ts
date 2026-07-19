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

  it('produces a valid asphalt triangle soup with uv + up normals', () => {
    const pos = geo.asphalt.getAttribute('position')
    expect(pos.count % 6).toBe(0) // 6 vertices per quad
    expect(pos.count).toBeGreaterThan(0)
    expect(geo.asphalt.getAttribute('uv').count).toBe(pos.count)
    expect(geo.asphalt.getAttribute('normal').count).toBe(pos.count)
    const nrm = geo.asphalt.getAttribute('normal')
    for (let i = 0; i < nrm.count; i++) {
      expect(nrm.getY(i)).toBe(1)
    }
  })

  it('keeps every asphalt vertex y within the plate band', () => {
    const pos = geo.asphalt.getAttribute('position')
    const maxDepth = Math.max(...graph.edges.map((e) => e.depth))
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(roadY(0) - 1e-6)
      expect(pos.getY(i)).toBeLessThanOrEqual(roadY(maxDepth) + 0.002 + 1e-6)
    }
  })

  it('spans v from 0 to 1 across asphalt quads', () => {
    const uv = geo.asphalt.getAttribute('uv')
    let sawV0 = false
    let sawV1 = false
    for (let i = 0; i < uv.count; i++) {
      if (uv.getY(i) === 0) sawV0 = true
      if (uv.getY(i) === 1) sawV1 = true
    }
    expect(sawV0).toBe(true)
    expect(sawV1).toBe(true)
  })

  it('builds raised sidewalks with a curb face (grayscale vertex colours)', () => {
    const sw = geo.sidewalk
    const pos = sw.getAttribute('position')
    const col = sw.getAttribute('color')
    expect(pos.count).toBeGreaterThan(0)
    expect(col.count).toBe(pos.count)
    // curb tops sit above the asphalt band; some vertices are raised
    let maxY = 0
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i))
    expect(maxY).toBeGreaterThan(roadY(0) + 0.1)
    // both the lit top (1.0) and the shaded curb face (0.62) are present
    let sawTop = false
    let sawFace = false
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i)
      if (r === 1) sawTop = true
      if (Math.abs(r - 0.62) < 1e-6) sawFace = true
    }
    expect(sawTop).toBe(true)
    expect(sawFace).toBe(true)
  })

  it('handles an empty graph', () => {
    const empty = buildRoadGeometry(buildRoadGraph([]))
    expect(empty.asphalt.getAttribute('position').count).toBe(0)
    expect(empty.sidewalk.getAttribute('position').count).toBe(0)
    expect(empty.crosswalk.getAttribute('position').count).toBe(0)
  })
})
