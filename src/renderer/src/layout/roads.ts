/**
 * Road graph built from the treemap's street centerlines.
 *
 * All segments are axis-aligned. Crossings (including T-junctions created by
 * child streets extended toward their enclosing avenue) become shared nodes;
 * segments are split at every crossing so traffic can turn there. Endpoints
 * within reach of a perpendicular road's half-width are snapped onto its
 * centerline, which is what turns "almost touching" tee stubs into real
 * junctions.
 */

import type { RoadSegment } from './treemap'

export interface RoadNode {
  x: number
  z: number
}

export interface RoadEdge {
  /** node indices */
  a: number
  b: number
  axis: 'x' | 'z'
  width: number
  length: number
  depth: number
}

export interface RoadGraph {
  nodes: RoadNode[]
  edges: RoadEdge[]
  /** node index -> indices of incident edges */
  adjacency: number[][]
}

const Q = 100 // quantize coordinates to 0.01 world units when merging nodes
const MIN_EDGE_LEN = 0.05

interface Seg {
  axis: 'x' | 'z'
  /** fixed coordinate (x for z-roads, z for x-roads) */
  at: number
  lo: number
  hi: number
  width: number
  depth: number
  cuts: number[]
}

export function buildRoadGraph(segments: RoadSegment[]): RoadGraph {
  const segs: Seg[] = segments.map((s) => ({
    axis: s.axis,
    at: s.axis === 'z' ? s.x : s.z,
    lo: s.axis === 'z' ? s.z : s.x,
    hi: s.axis === 'z' ? s.z + s.length : s.x + s.length,
    width: s.width,
    depth: s.depth,
    cuts: []
  }))

  const zSegs = segs.filter((s) => s.axis === 'z')
  const xSegs = segs.filter((s) => s.axis === 'x')

  // Find crossings between every perpendicular pair. Tolerance is the pair's
  // combined half-widths: an endpoint that stops just short of a crossing
  // street still counts, and the segment is stretched to the centerline.
  for (const v of zSegs) {
    for (const h of xSegs) {
      const tol = (v.width + h.width) / 2
      if (v.at < h.lo - tol || v.at > h.hi + tol) continue
      if (h.at < v.lo - tol || h.at > v.hi + tol) continue
      // snap: stretch each segment to include the exact crossing coordinate
      if (h.at < v.lo) v.lo = h.at
      if (h.at > v.hi) v.hi = h.at
      if (v.at < h.lo) h.lo = v.at
      if (v.at > h.hi) h.hi = v.at
      v.cuts.push(h.at)
      h.cuts.push(v.at)
    }
  }

  const nodes: RoadNode[] = []
  const nodeIndex = new Map<string, number>()
  const nodeAt = (x: number, z: number): number => {
    const key = `${Math.round(x * Q)},${Math.round(z * Q)}`
    let idx = nodeIndex.get(key)
    if (idx === undefined) {
      idx = nodes.length
      nodes.push({ x, z })
      nodeIndex.set(key, idx)
    }
    return idx
  }

  const edges: RoadEdge[] = []
  for (const s of segs) {
    const stops = [s.lo, ...s.cuts.sort((a, b) => a - b), s.hi]
    let prev = s.lo
    for (const stop of stops) {
      const c0 = Math.min(prev, stop)
      const c1 = Math.max(prev, stop)
      if (c1 - c0 >= MIN_EDGE_LEN) {
        const a = s.axis === 'z' ? nodeAt(s.at, c0) : nodeAt(c0, s.at)
        const b = s.axis === 'z' ? nodeAt(s.at, c1) : nodeAt(c1, s.at)
        if (a !== b) {
          edges.push({ a, b, axis: s.axis, width: s.width, length: c1 - c0, depth: s.depth })
        }
      }
      prev = Math.max(prev, stop)
    }
  }

  const adjacency: number[][] = nodes.map(() => [])
  edges.forEach((e, i) => {
    adjacency[e.a].push(i)
    adjacency[e.b].push(i)
  })

  return { nodes, edges, adjacency }
}
