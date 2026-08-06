import { describe, expect, it } from 'vitest'
import { buildPointGrid, nearest } from './nearest'
import { cityLayout, type CityInput } from './treemap'
import { buildRoadGraph } from './roads'

/**
 * The scan the grid replaces, verbatim in behaviour: lowest index wins ties,
 * and an empty point set answers 0. Every test below is an equivalence test
 * against this, because the grid's only job is to be the same function faster.
 */
function bruteForce(xs: number[], zs: number[], x: number, z: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - x
    const dz = zs[i] - z
    const d = dx * dx + dz * dz
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Deterministic PRNG so a failure is reproducible from the test name alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function expectAgrees(xs: number[], zs: number[], queries: [number, number][]): void {
  const grid = buildPointGrid(xs, zs)
  for (const [qx, qz] of queries) {
    expect(nearest(grid, qx, qz), `query (${qx}, ${qz})`).toBe(bruteForce(xs, zs, qx, qz))
  }
}

describe('buildPointGrid / nearest', () => {
  it('matches brute force over a random spread', () => {
    const r = rng(1)
    const xs: number[] = []
    const zs: number[] = []
    for (let i = 0; i < 500; i++) {
      xs.push(r() * 200 - 100)
      zs.push(r() * 200 - 100)
    }
    const queries: [number, number][] = []
    for (let i = 0; i < 500; i++) queries.push([r() * 200 - 100, r() * 200 - 100])
    expectAgrees(xs, zs, queries)
  })

  it('matches brute force when the points are clustered far from the query', () => {
    // Worst case for the ring walk: everything in one corner, queries in the
    // opposite one, so the early exit has to survive many empty rings.
    const r = rng(7)
    const xs: number[] = []
    const zs: number[] = []
    for (let i = 0; i < 300; i++) {
      xs.push(r() * 2 - 100)
      zs.push(r() * 2 - 100)
    }
    xs.push(100, 99)
    zs.push(100, 99)
    const queries: [number, number][] = []
    for (let i = 0; i < 200; i++) queries.push([r() * 200 - 100, r() * 200 - 100])
    expectAgrees(xs, zs, queries)
  })

  it('matches brute force on a grid-aligned lattice, where every cell boundary is a tie', () => {
    const xs: number[] = []
    const zs: number[] = []
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        xs.push(i)
        zs.push(j)
      }
    }
    const queries: [number, number][] = []
    // Exactly on lattice points, exactly between them, and on the half-cell
    // lines where four points are equidistant.
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        queries.push([i, j], [i + 0.5, j], [i, j + 0.5], [i + 0.5, j + 0.5])
      }
    }
    expectAgrees(xs, zs, queries)
  })

  it('resolves ties to the lowest index, whatever order the cells are walked', () => {
    // Four points equidistant from the origin. The scan would pick index 0;
    // so must the grid, or two runs of the same city disagree.
    const xs = [1, -1, 0, 0]
    const zs = [0, 0, 1, -1]
    const grid = buildPointGrid(xs, zs)
    expect(nearest(grid, 0, 0)).toBe(0)
    expect(nearest(grid, 0, 0)).toBe(bruteForce(xs, zs, 0, 0))
  })

  it('resolves duplicate points to the lowest index', () => {
    const xs = [5, 5, 5]
    const zs = [5, 5, 5]
    expect(nearest(buildPointGrid(xs, zs), 5, 5)).toBe(0)
    expect(nearest(buildPointGrid(xs, zs), 99, 99)).toBe(0)
  })

  it('answers 0 for an empty point set', () => {
    const grid = buildPointGrid([], [])
    expect(nearest(grid, 0, 0)).toBe(0)
    expect(nearest(grid, 1e6, -1e6)).toBe(0)
  })

  it('handles a single point', () => {
    const grid = buildPointGrid([3], [4])
    expect(nearest(grid, 0, 0)).toBe(0)
    expect(nearest(grid, 1e6, 1e6)).toBe(0)
  })

  it('handles collinear points, which give the bounding box zero height', () => {
    const xs = [0, 1, 2, 3, 4, 5]
    const zs = [7, 7, 7, 7, 7, 7]
    const queries: [number, number][] = [
      [0, 7],
      [2.4, 7],
      [2.6, -50],
      [5, 7],
      [-100, 7],
      [100, 7]
    ]
    expectAgrees(xs, zs, queries)
  })

  it('handles points stacked on one x, which gives the bounding box zero width', () => {
    const xs = [2, 2, 2, 2]
    const zs = [0, 1, 2, 3]
    expectAgrees(xs, zs, [
      [2, 0],
      [2, 1.6],
      [-40, 2.9],
      [2, 100]
    ])
  })

  it('answers queries far outside the point bounds', () => {
    const r = rng(3)
    const xs: number[] = []
    const zs: number[] = []
    for (let i = 0; i < 200; i++) {
      xs.push(r() * 10)
      zs.push(r() * 10)
    }
    expectAgrees(xs, zs, [
      [-1e6, -1e6],
      [1e6, 1e6],
      [-1e6, 5],
      [5, 1e6]
    ])
  })

  it('matches brute force on a treemap-like spread of many points', () => {
    // Closer to the real input: plot centres over a 280-unit city, which is
    // what `citySize` resolves to at the drawn cap.
    const r = rng(11)
    const n = 5000
    const xs: number[] = []
    const zs: number[] = []
    for (let i = 0; i < n; i++) {
      xs.push(r() * 280 - 140)
      zs.push(r() * 280 - 140)
    }
    const queries: [number, number][] = []
    for (let i = 0; i < 1000; i++) queries.push([r() * 300 - 150, r() * 300 - 150])
    expectAgrees(xs, zs, queries)
  })
})

/**
 * The real thing: a treemap city and its road graph, with the grid answering
 * exactly what Traffic's per-edge scan used to answer, edge for edge.
 *
 * 5,000 files runs in CI. The drawn cap (20,000, where the scan costs ~10⁹
 * distance checks) is opt-in, because brute-forcing it to compare against is
 * the very thing this module exists to stop doing:
 *   GITCITY_NEAREST_FULL=1 npx vitest run src/renderer/src/layout/nearest.test.ts
 */
const DIRS = [
  'src/core',
  'src/core/render',
  'src/ui',
  'src/ui/panels',
  'src/lib',
  'main/git',
  'test',
  'docs'
]

function synthFiles(n: number): CityInput[] {
  const files: CityInput[] = []
  for (let i = 0; i < n; i++) {
    const dir = DIRS[i % DIRS.length]
    files.push({ path: `${dir}/file${i.toString(36)}.ts`, weight: 20 + ((i * 37) % 4000) })
  }
  return files
}

/** What Traffic.tsx did before: scan every plot, per edge. */
function scanNearestPlot(
  plots: { rect: { x: number; y: number; w: number; h: number } }[],
  graph: ReturnType<typeof buildRoadGraph>
): Int32Array {
  const out = new Int32Array(graph.edges.length)
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const e = graph.edges[ei]
    const mx = (graph.nodes[e.a].x + graph.nodes[e.b].x) / 2
    const mz = (graph.nodes[e.a].z + graph.nodes[e.b].z) / 2
    let best = 0
    let bestD = Infinity
    for (let pi = 0; pi < plots.length; pi++) {
      const r = plots[pi].rect
      const dx = r.x + r.w / 2 - mx
      const dz = r.y + r.h / 2 - mz
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        best = pi
      }
    }
    out[ei] = best
  }
  return out
}

/** What Traffic.tsx does now. */
function gridNearestPlot(
  plots: { rect: { x: number; y: number; w: number; h: number } }[],
  graph: ReturnType<typeof buildRoadGraph>
): Int32Array {
  const cx = new Float64Array(plots.length)
  const cz = new Float64Array(plots.length)
  for (let pi = 0; pi < plots.length; pi++) {
    const r = plots[pi].rect
    cx[pi] = r.x + r.w / 2
    cz[pi] = r.y + r.h / 2
  }
  const grid = buildPointGrid(cx, cz)
  const out = new Int32Array(graph.edges.length)
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const e = graph.edges[ei]
    const mx = (graph.nodes[e.a].x + graph.nodes[e.b].x) / 2
    const mz = (graph.nodes[e.a].z + graph.nodes[e.b].z) / 2
    out[ei] = nearest(grid, mx, mz)
  }
  return out
}

describe("Traffic's nearest plot per road edge", () => {
  // 280 is what cityData's `min(280, sqrt(files) * 9)` resolves to at these
  // sizes — the value the scene actually lays out at, not layoutPerf's 140.
  const CITY_SIZE = 280

  const sizes = process.env.GITCITY_NEAREST_FULL ? [5_000, 20_000] : [5_000]

  for (const n of sizes) {
    it(`is byte-identical to the per-edge scan at ${n.toLocaleString()} files`, () => {
      const layout = cityLayout(synthFiles(n), CITY_SIZE)
      const graph = buildRoadGraph(layout.roads)
      expect(graph.edges.length).toBeGreaterThan(0)

      const scanned = scanNearestPlot(layout.plots, graph)
      const gridded = gridNearestPlot(layout.plots, graph)

      console.log(
        `${n.toLocaleString().padStart(6)} files  ` +
          `${layout.plots.length.toLocaleString()} plots  ` +
          `${graph.edges.length.toLocaleString()} edges`
      )
      expect(gridded).toEqual(scanned)
    })
  }
})
