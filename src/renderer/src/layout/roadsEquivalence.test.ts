import { describe, expect, it } from 'vitest'
import { buildRoadGraph, type RoadGraph } from './roads'
import { cityLayout, type CityInput, type RoadSegment } from './treemap'

/**
 * `buildRoadGraph` must produce exactly the graph the nested scan produced.
 *
 * The scan mutated the segments it was iterating — an accepted crossing
 * stretches both segments, so a pair rejected early can be accepted later. The
 * output depends on visit order, which makes "obviously equivalent" a claim
 * that has to be tested rather than argued. This file keeps the original
 * implementation and diffs the whole graph against it, on every tree shape the
 * layout can produce.
 */

const Q = 100
const MIN_EDGE_LEN = 0.05

interface Seg {
  axis: 'x' | 'z'
  at: number
  lo: number
  hi: number
  width: number
  depth: number
  cuts: number[]
}

/** buildRoadGraph exactly as it was before the index went in. */
function referenceRoadGraph(segments: RoadSegment[]): RoadGraph {
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

  for (const v of zSegs) {
    for (const h of xSegs) {
      const tol = (v.width + h.width) / 2
      if (v.at < h.lo - tol || v.at > h.hi + tol) continue
      if (h.at < v.lo - tol || h.at > v.hi + tol) continue
      if (h.at < v.lo) v.lo = h.at
      if (h.at > v.hi) v.hi = h.at
      if (v.at < h.lo) h.lo = v.at
      if (v.at > h.hi) h.hi = v.at
      v.cuts.push(h.at)
      h.cuts.push(v.at)
    }
  }

  const nodes: { x: number; z: number }[] = []
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

  const edges: RoadGraph['edges'] = []
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

function expectSameGraph(segments: RoadSegment[], label: string): RoadGraph {
  const want = referenceRoadGraph(segments)
  const got = buildRoadGraph(segments)
  expect(got.nodes, `${label}: nodes`).toEqual(want.nodes)
  expect(got.edges, `${label}: edges`).toEqual(want.edges)
  expect(got.adjacency, `${label}: adjacency`).toEqual(want.adjacency)
  return got
}

function files(paths: [string, number][]): CityInput[] {
  return paths.map(([path, weight]) => ({ path, weight }))
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('buildRoadGraph is byte-identical to the scan it replaced', () => {
  it('on a wide, flat tree', () => {
    const f: [string, number][] = []
    for (let i = 0; i < 400; i++) f.push([`flat/file${i}.ts`, 20 + ((i * 37) % 900)])
    const layout = cityLayout(files(f), 140)
    const g = expectSameGraph(layout.roads, 'wide-flat')
    expect(g.edges.length).toBeGreaterThan(0)
  })

  it('on a deep, narrow tree', () => {
    const f: [string, number][] = []
    let dir = 'a'
    for (let i = 0; i < 200; i++) {
      dir += '/d'
      f.push([`${dir}/file${i}.ts`, 20 + ((i * 53) % 700)])
    }
    const layout = cityLayout(files(f), 140)
    expectSameGraph(layout.roads, 'deep-narrow')
  })

  it('on a monorepo shape, at the city size the scene actually uses', () => {
    const dirs = ['src/core', 'src/ui', 'src/ui/panels', 'src/lib', 'main/git', 'test', 'docs', '']
    const f: [string, number][] = []
    for (let i = 0; i < 5_000; i++) {
      const d = dirs[i % dirs.length]
      f.push([d ? `${d}/file${i.toString(36)}.ts` : `file${i}.ts`, 20 + ((i * 37) % 4000)])
    }
    const layout = cityLayout(files(f), 280)
    const g = expectSameGraph(layout.roads, 'monorepo-5k')
    expect(g.edges.length).toBeGreaterThan(1000)
  })

  it('on one enormous directory of siblings', () => {
    const f: [string, number][] = []
    for (let i = 0; i < 2_000; i++) f.push([`tests/baselines/reference/f${i}.js`, 10 + (i % 300)])
    const layout = cityLayout(files(f), 280)
    expectSameGraph(layout.roads, 'flat-baselines')
  })

  it('on random segment soup, where cascading snaps are most likely', () => {
    // Not a treemap — deliberately degenerate, with many near-touching ends at
    // widths large enough that snapping chains.
    const r = rng(5)
    for (let round = 0; round < 20; round++) {
      const segments: RoadSegment[] = []
      for (let i = 0; i < 120; i++) {
        const axis = r() < 0.5 ? 'x' : 'z'
        segments.push({
          axis,
          x: Math.round(r() * 40) / 2,
          z: Math.round(r() * 40) / 2,
          length: 0.5 + r() * 8,
          width: 0.35 + r() * 5,
          depth: Math.floor(r() * 3)
        })
      }
      expectSameGraph(segments, `soup-${round}`)
    }
  })

  it('on segments sharing one coordinate, so the index slice is the whole set', () => {
    const segments: RoadSegment[] = []
    for (let i = 0; i < 60; i++) {
      segments.push({ axis: 'x', x: -20, z: 0, length: 40, width: 1, depth: 0 })
      segments.push({ axis: 'z', x: i - 30, z: -20, length: 40, width: 1, depth: 0 })
    }
    expectSameGraph(segments, 'shared-coordinate')
  })

  it('on empty and single-axis inputs', () => {
    expectSameGraph([], 'empty')
    expectSameGraph([{ axis: 'z', x: 0, z: -5, length: 10, width: 1, depth: 0 }], 'one-z')
    expectSameGraph([{ axis: 'x', x: -5, z: 0, length: 10, width: 1, depth: 0 }], 'one-x')
  })
})
