/**
 * Static road-surface geometry built from the road graph: one flat quad per
 * graph edge plus a plain square at every junction, merged into a single
 * BufferGeometry (one draw call, built once per city model).
 *
 * UVs: u = world-units along the street divided by DASH_PERIOD, using the
 * absolute coordinate so dashes stay continuous across junction-split edges;
 * v = 0..1 across the width. Junction quads use a constant UV inside the
 * texture's plain-asphalt area so they never show markings.
 */

import { BufferAttribute, BufferGeometry } from 'three'
import type { RoadGraph } from '../layout/roads'

/** world units per dash cycle in the road texture */
export const DASH_PERIOD = 4
/** constant UV of a marking-free texel (texture edge rows are plain asphalt) */
const PLAIN_U = 0.25
const PLAIN_V = 0.1

/** top surface of the district plate a road of this depth lies on */
export function roadY(depth: number): number {
  return depth > 0 ? depth * 0.09 + 0.06 + 0.004 : 0.004
}

export function buildRoadGeometry(graph: RoadGraph): BufferGeometry {
  interface Quad {
    // corner order: (a-left, a-right, b-right, b-left) seen from above
    xs: [number, number, number, number]
    zs: [number, number, number, number]
    y: number
    uvs: [number, number][]
  }
  const quads: Quad[] = []

  // A junction exists where edges of both axes meet (T or X) or 3+ edges meet.
  const junctionSize: (number | null)[] = graph.nodes.map((_, ni) => {
    const inc = graph.adjacency[ni]
    if (inc.length < 2) return null
    const axes = new Set(inc.map((ei) => graph.edges[ei].axis))
    if (inc.length === 2 && axes.size === 1) return null // straight pass-through
    return Math.max(...inc.map((ei) => graph.edges[ei].width))
  })

  for (const e of graph.edges) {
    const na = graph.nodes[e.a]
    const nb = graph.nodes[e.b]
    const y = roadY(e.depth)
    const half = e.width / 2
    // trim the quad back from junction squares so surfaces never stack
    const trimA = junctionSize[e.a] !== null ? junctionSize[e.a]! / 2 : 0
    const trimB = junctionSize[e.b] !== null ? junctionSize[e.b]! / 2 : 0

    if (e.axis === 'z') {
      const x = na.x
      const z0 =
        Math.min(na.z, nb.z) + trimA * (na.z < nb.z ? 1 : 0) + trimB * (nb.z < na.z ? 1 : 0)
      const z1 =
        Math.max(na.z, nb.z) - trimA * (na.z > nb.z ? 1 : 0) - trimB * (nb.z > na.z ? 1 : 0)
      if (z1 - z0 < 0.05) continue
      quads.push({
        xs: [x - half, x + half, x + half, x - half],
        zs: [z0, z0, z1, z1],
        y,
        uvs: [
          [z0 / DASH_PERIOD, 0],
          [z0 / DASH_PERIOD, 1],
          [z1 / DASH_PERIOD, 1],
          [z1 / DASH_PERIOD, 0]
        ]
      })
    } else {
      const z = na.z
      const x0 =
        Math.min(na.x, nb.x) + trimA * (na.x < nb.x ? 1 : 0) + trimB * (nb.x < na.x ? 1 : 0)
      const x1 =
        Math.max(na.x, nb.x) - trimA * (na.x > nb.x ? 1 : 0) - trimB * (nb.x > na.x ? 1 : 0)
      if (x1 - x0 < 0.05) continue
      quads.push({
        xs: [x0, x0, x1, x1],
        zs: [z - half, z + half, z + half, z - half],
        y,
        uvs: [
          [x0 / DASH_PERIOD, 0],
          [x0 / DASH_PERIOD, 1],
          [x1 / DASH_PERIOD, 1],
          [x1 / DASH_PERIOD, 0]
        ]
      })
    }
  }

  // junction squares sit a hair above the street quads (lowest incident plate)
  graph.nodes.forEach((n, ni) => {
    const size = junctionSize[ni]
    if (size === null) return
    const half = size / 2
    const y = roadY(Math.min(...graph.adjacency[ni].map((ei) => graph.edges[ei].depth))) + 0.002
    quads.push({
      xs: [n.x - half, n.x + half, n.x + half, n.x - half],
      zs: [n.z - half, n.z - half, n.z + half, n.z + half],
      y,
      uvs: [
        [PLAIN_U, PLAIN_V],
        [PLAIN_U, PLAIN_V],
        [PLAIN_U, PLAIN_V],
        [PLAIN_U, PLAIN_V]
      ]
    })
  })

  const positions = new Float32Array(quads.length * 6 * 3)
  const normals = new Float32Array(quads.length * 6 * 3)
  const uvs = new Float32Array(quads.length * 6 * 2)
  // two CCW triangles (0,2,1)(0,3,2) seen from +Y
  const order = [0, 2, 1, 0, 3, 2]
  quads.forEach((q, qi) => {
    for (let v = 0; v < 6; v++) {
      const c = order[v]
      const o = (qi * 6 + v) * 3
      positions[o] = q.xs[c]
      positions[o + 1] = q.y
      positions[o + 2] = q.zs[c]
      normals[o + 1] = 1
      const uo = (qi * 6 + v) * 2
      uvs[uo] = q.uvs[c][0]
      uvs[uo + 1] = q.uvs[c][1]
    }
  })

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  geo.setAttribute('uv', new BufferAttribute(uvs, 2))
  return geo
}
