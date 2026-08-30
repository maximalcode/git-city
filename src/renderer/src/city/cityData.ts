import { Color } from 'three'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import { layoutWeights } from '../layout/weights'
import { cityLayout, type CityLayout } from '../layout/treemap'
import { buildRoadGraph, type RoadGraph } from '../layout/roads'
import { capFiles } from '../layout/cap'
import { languageOf } from '../lib/languages'
import { buildColorer, type ColorMode } from './colorModes'

/**
 * The static city model: layout is computed once per analysis over the union
 * of every file that ever existed (weighted by its peak line count), so
 * buildings keep a stable position while scrubbing through history —
 * they rise, shrink and vanish, but never move.
 */
export interface CityModel {
  layout: CityLayout
  /** street graph derived from layout.roads; shared by Roads + Traffic */
  roadGraph: RoadGraph
  /** building index → file path */
  paths: string[]
  indexOf: Map<string, number>
  /** per-building language color */
  langColors: Color[]
  citySize: number
  /** files the repository has, which is more than `paths` when capped (#12) */
  totalFiles: number
  capped: boolean
}

export interface Targets {
  /** per-building target height (0 = absent at this snapshot) */
  heights: Float32Array
  /** per-building rgb triplets */
  colors: Float32Array
}

export function heightFor(loc: number): number {
  return Math.min(45, Math.max(0.4, Math.pow(loc, 0.5) * 0.32))
}

export function buildCityModel(analysis: RepoAnalysis): CityModel {
  const weights = layoutWeights(analysis)
  // Past the ceiling we draw the largest files and say so, rather than
  // spending 80 seconds building a scene whose streets have already
  // vanished (#12). `weights` is peak LOC per path, so the kept set is the
  // same for every frame of the timeline.
  const { files, total, capped } = capFiles(
    Array.from(weights, ([path, weight]) => ({ path, weight }))
  )
  const citySize = Math.max(80, Math.min(280, Math.sqrt(files.length) * 9))
  const layout = cityLayout(files, citySize)
  const roadGraph = buildRoadGraph(layout.roads)
  const paths = layout.plots.map((p) => p.path)
  const indexOf = new Map(paths.map((p, i) => [p, i]))
  const langColors = paths.map((p) => new Color(languageOf(p).color))
  return { layout, roadGraph, paths, indexOf, langColors, citySize, totalFiles: total, capped }
}

const scratch = new Color()

export function snapshotTargets(
  model: CityModel,
  snapshot: Snapshot,
  colorMode: ColorMode
): Targets {
  const n = model.paths.length
  const heights = new Float32Array(n)
  const colors = new Float32Array(n * 3)

  const byPath = new Map(snapshot.files.map((f) => [f.path, f]))
  const colorer = buildColorer(model, snapshot, colorMode)

  for (let i = 0; i < n; i++) {
    const f = byPath.get(model.paths[i])
    if (!f) continue
    heights[i] = heightFor(f.loc)
    const c = colorer.colorFor(f, i, scratch)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  return { heights, colors }
}
