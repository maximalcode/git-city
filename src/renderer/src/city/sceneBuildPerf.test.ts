import { describe, expect, it } from 'vitest'
import { buildMockAnalysis } from '../lib/devMock'
import { materializeSnapshot, peakLocByPath } from '../../../shared/snapshots'
import { cityLayout } from '../layout/treemap'
import { buildRoadGraph } from '../layout/roads'
import { capFiles } from '../layout/cap'
import { buildCityModel, snapshotTargets } from './cityData'
import { buildRoadGeometry, junctionHalfSizes } from './roadGeometry'
import { buildStreetDetail } from './streetFurniture'
import { buildPointGrid, nearest } from '../layout/nearest'

/**
 * What the gap between "Reading history… 100%" and the city appearing is
 * actually spent on (#12).
 *
 * Runs in Node, against the same synthetic repository the preview draws, and
 * covers every stage of the scene build that does not need a GL context or a
 * canvas. That is a deliberate limit, not an oversight: the remainder —
 * react-three-fiber reconciliation, `pbrTextures()` decode, shader compile,
 * the district label `CanvasTexture`s and the first shadow pass — can only be
 * measured with a real, visible, unoccluded window. Measuring it through an
 * automated browser is what produced the numbers in `layout/cap.ts` that
 * turned out to be screenshot timestamps rather than measurements (#82).
 *
 * So this file is the **floor**, and the difference between it and an observed
 * wall clock is the tail. It asserts almost nothing — the printed table is the
 * deliverable, and the only failure condition is a stage not finishing.
 *
 *   npx vitest run src/renderer/src/city/sceneBuildPerf.test.ts
 */

const ms = (v: number): string => `${v.toFixed(1).padStart(8)}ms`

/** Stages whose label is indented are a breakdown of the line above them. */
const isBreakdown = (label: string): boolean => label.startsWith('  ')

describe('scene build cost by repo size', () => {
  // 250 is the preview default, 5,000 a large real project, 20,000 the drawn
  // cap — past which `capFiles` means the scene never gets any bigger.
  for (const n of [250, 5_000, 20_000]) {
    it(`builds the scene for ${n.toLocaleString()} files`, () => {
      const analysis = buildMockAnalysis(n)

      const pass = (
        stages: [string, number][] | null
      ): { drawn: number; edges: number } => {
        const time = <T>(label: string, fn: () => T): T => {
          const t = performance.now()
          const out = fn()
          stages?.push([label, performance.now() - t])
          return out
        }

        const model = time('buildCityModel', () => buildCityModel(analysis))
        // Two of buildCityModel's parts are the quadratics PR 2 targets, so
        // they are sized separately — on the *same* inputs buildCityModel
        // derived, or the numbers describe a different city than the one the
        // line above built.
        const weights = new Map<string, number>()
        for (const [path, peak] of peakLocByPath(analysis)) weights.set(path, Math.max(peak, 1))
        const files = capFiles(Array.from(weights, ([path, weight]) => ({ path, weight }))).files
        const layout = time('  cityLayout (incl. emitRoads)', () =>
          cityLayout(files, model.citySize)
        )
        time('  buildRoadGraph', () => buildRoadGraph(layout.roads))

        const snapshot = time('materializeSnapshot', () =>
          materializeSnapshot(analysis, analysis.snapshots.length - 1)
        )
        time('snapshotTargets', () => snapshotTargets(model, snapshot, 'language'))
        time('buildRoadGeometry', () => buildRoadGeometry(model.roadGraph))
        time('junctionHalfSizes', () => junctionHalfSizes(model.roadGraph))
        time('buildStreetDetail', () =>
          buildStreetDetail(model.roadGraph, Math.min(1, model.citySize / 140))
        )
        time('Traffic.nearestPlot', () => {
          const plots = model.layout.plots
          const cx = new Float64Array(plots.length)
          const cz = new Float64Array(plots.length)
          for (let pi = 0; pi < plots.length; pi++) {
            const r = plots[pi].rect
            cx[pi] = r.x + r.w / 2
            cz[pi] = r.y + r.h / 2
          }
          const grid = buildPointGrid(cx, cz)
          const graph = model.roadGraph
          const out = new Int32Array(graph.edges.length)
          for (let ei = 0; ei < graph.edges.length; ei++) {
            const e = graph.edges[ei]
            out[ei] = nearest(
              grid,
              (graph.nodes[e.a].x + graph.nodes[e.b].x) / 2,
              (graph.nodes[e.a].z + graph.nodes[e.b].z) / 2
            )
          }
          return out
        })

        return { drawn: model.paths.length, edges: model.roadGraph.edges.length }
      }

      pass(null) // discarded: without it the first stage measured pays for JIT
      const stages: [string, number][] = []
      const { drawn, edges } = pass(stages)

      const total = stages
        .filter(([label]) => !isBreakdown(label))
        .reduce((a, [, v]) => a + v, 0)

      console.log(
        `\n--- scene build: ${n.toLocaleString()} files ` +
          `(${drawn.toLocaleString()} drawn, ${edges.toLocaleString()} road edges) ---`
      )
      for (const [label, v] of stages) console.log(`  ${label.padEnd(30)}${ms(v)}`)
      console.log(`  ${'TOTAL (no GL, no canvas)'.padEnd(30)}${ms(total)}\n`)

      expect(drawn).toBeGreaterThan(0)
    })
  }
})
