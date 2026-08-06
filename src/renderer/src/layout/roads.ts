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
/** window retries before crossSegments gives up and scans everything */
const MAX_WINDOW_ATTEMPTS = 3

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

  crossSegments(zSegs, xSegs)

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

/**
 * Snap and cut every perpendicular pair that crosses.
 *
 * This is the nested scan it replaces, pair for pair and **in the same order**
 * — which matters more than it looks, because the loop mutates the segments it
 * is iterating. An accepted crossing stretches both segments to reach it, so a
 * pair rejected early can be accepted later once one of them has grown, and
 * the result therefore depends on visit order. Measured on a 20,000-file city,
 * ranges grow by up to 58 units against a 5.78 max width, so those cascades
 * are real rather than theoretical: reordering the visit — a sweep, a spatial
 * index walked in spatial order — quietly produces a different city.
 *
 * Two things make it faster without touching that order (#12):
 *
 * 1. **Skip pairs that cannot match.** `h.at` is the one coordinate that never
 *    moves, so it is safe to index on. With the x-segments sorted by it once,
 *    each z-segment only considers the slice satisfying
 *    `h.at ∈ [v.lo - tol, v.hi + tol]`; since `tol ≤ (v.width + maxWidth) / 2`,
 *    everything outside is provably a miss. At the drawn cap that is 3.2% of
 *    307,841,030 pairs. The slice is put back into original order before it is
 *    walked, which is what keeps the semantics above.
 * 2. **Read from typed arrays**, not object properties, in the hot loop.
 *
 * `v` grows as its own crossings are found, so a slice can turn out to have
 * been too narrow. When that happens the segment's work is rolled back and
 * retried against a wider window; after three attempts it scans everything,
 * which is the original algorithm and cannot be wrong.
 *
 * **What this does not do** is reach the ~40ms the #12 plan hoped for. Sorting
 * each slice back into original order costs about 430ms of the remaining
 * 621ms — measured by skipping the sort, which runs in 191ms and produces the
 * wrong city. Beating that means giving up byte-identical output, and the
 * layout is the product. Left at 2.2x deliberately; see the PR for why chasing
 * the rest is not worth it until the GL tail is measured.
 */
function crossSegments(zSegs: Seg[], xSegs: Seg[]): void {
  const n = xSegs.length
  if (n === 0 || zSegs.length === 0) return

  const hAt = new Float64Array(n)
  const hLo = new Float64Array(n)
  const hHi = new Float64Array(n)
  const hW = new Float64Array(n)
  let maxWidth = 0
  for (let i = 0; i < n; i++) {
    const h = xSegs[i]
    hAt[i] = h.at
    hLo[i] = h.lo
    hHi[i] = h.hi
    hW[i] = h.width
    if (h.width > maxWidth) maxWidth = h.width
  }

  const byAt = Int32Array.from(xSegs.keys()).sort((a, b) => hAt[a] - hAt[b])
  const sortedAts = Float64Array.from(byAt, (i) => hAt[i])
  const slice = new Int32Array(n)

  for (const v of zSegs) {
    const vAt = v.at
    const vW = v.width
    // the widest `tol` any pair involving this segment can have
    const reach = (vW + maxWidth) / 2
    let windowLo = v.lo - reach
    let windowHi = v.hi + reach

    for (let attempt = 0; ; attempt++) {
      const full = attempt >= MAX_WINDOW_ATTEMPTS
      let count = n
      if (!full) {
        const from = lowerBound(sortedAts, windowLo)
        count = upperBound(sortedAts, windowHi) - from
        for (let k = 0; k < count; k++) slice[k] = byAt[from + k]
        // back into original order — the scan this replaces visits x-segments
        // in array order, and the mutation above makes that observable
        slice.subarray(0, count).sort()
      }

      const vLo0 = v.lo
      const vHi0 = v.hi
      const vCuts0 = v.cuts.length
      const touched: number[] = []
      const touchedLo: number[] = []
      const touchedHi: number[] = []
      let vLo = v.lo
      let vHi = v.hi
      let outgrew = false

      for (let k = 0; k < count; k++) {
        const i = full ? k : slice[k]
        const at = hAt[i]
        const tol = (vW + hW[i]) / 2
        if (at < vLo - tol || at > vHi + tol) continue
        const lo = hLo[i]
        const hi = hHi[i]
        if (vAt < lo - tol || vAt > hi + tol) continue

        // snap: stretch each segment to include the exact crossing coordinate
        if (at < vLo) vLo = at
        if (at > vHi) vHi = at
        touched.push(i)
        touchedLo.push(lo)
        touchedHi.push(hi)
        if (vAt < lo) hLo[i] = vAt
        if (vAt > hi) hHi[i] = vAt
        v.cuts.push(at)
        xSegs[i].cuts.push(vAt)

        if (!full && (vLo - reach < windowLo || vHi + reach > windowHi)) {
          outgrew = true
          break
        }
      }

      if (!outgrew) {
        v.lo = vLo
        v.hi = vHi
        break
      }

      // The window was too narrow: undo everything this segment did, widen to
      // cover where it got to, and start it over.
      for (let j = touched.length - 1; j >= 0; j--) {
        hLo[touched[j]] = touchedLo[j]
        hHi[touched[j]] = touchedHi[j]
        xSegs[touched[j]].cuts.pop()
      }
      v.lo = vLo0
      v.hi = vHi0
      v.cuts.length = vCuts0
      windowLo = Math.min(windowLo, vLo - reach)
      windowHi = Math.max(windowHi, vHi + reach)
    }
  }

  // the x-segments' ranges lived in the typed arrays for the duration
  for (let i = 0; i < n; i++) {
    xSegs[i].lo = hLo[i]
    xSegs[i].hi = hHi[i]
  }
}

function lowerBound(values: Float64Array, target: number): number {
  let a = 0
  let b = values.length
  while (a < b) {
    const mid = (a + b) >> 1
    if (values[mid] < target) a = mid + 1
    else b = mid
  }
  return a
}

function upperBound(values: Float64Array, target: number): number {
  let a = 0
  let b = values.length
  while (a < b) {
    const mid = (a + b) >> 1
    if (values[mid] <= target) a = mid + 1
    else b = mid
  }
  return a
}
