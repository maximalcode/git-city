import { describe, expect, it } from 'vitest'
import { cityLayout, type CityInput } from './treemap'
import { buildRoadGraph } from './roads'

/**
 * How the scene math scales with file count.
 *
 * The analysis-side cost is measured in src/main/git/perf.test.ts; this is the
 * other half — laying a monorepo out as a city. It runs in Node because the
 * layout layer is deliberately free of three.js, so the numbers are stable and
 * repeatable in a way a frame-rate reading from an automated browser is not.
 *
 * GPU cost is NOT covered here. Instance counts scale 1:1 with plots, and
 * whether the scene stays interactive at 80k of them still needs measuring in
 * the real app.
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

describe('layout cost by repo size', () => {
  // the sizes that bracket the decision: a normal project, a big one, and a
  // monorepo the size of the TypeScript checkout measured in #12
  for (const n of [250, 5_000, 20_000, 81_368]) {
    it(`lays out ${n.toLocaleString()} files`, () => {
      const files = synthFiles(n)
      const started = performance.now()
      // the size the scene actually lays out at — `cityData` uses
      // `min(280, sqrt(files) * 9)`, which is 280 from 1,000 files up. Benching
      // at 140 halved the surviving road segments and so understated the cost.
      const layout = cityLayout(files, Math.max(80, Math.min(280, Math.sqrt(n) * 9)))
      const laidOut = performance.now()
      const graph = buildRoadGraph(layout.roads)
      const done = performance.now()

      console.log(
        `${n.toLocaleString().padStart(7)} files  ` +
          `treemap ${(laidOut - started).toFixed(0).padStart(5)}ms  ` +
          `roads ${(done - laidOut).toFixed(0).padStart(4)}ms  ` +
          `plots ${layout.plots.length.toLocaleString()}  ` +
          `districts ${layout.districts.length}  ` +
          `segments ${layout.roads.length.toLocaleString()}  ` +
          `nodes ${graph.nodes.length.toLocaleString()}`
      )

      expect(layout.plots.length).toBe(n)
    })
  }
})
