/**
 * Forest layout — the "groves by folder" view of a repository.
 *
 * Every file is one tree; a directory is a grove. Positions come straight from
 * the same squarified treemap the city uses, so the forest inherits its two
 * load-bearing properties: stability across snapshots (built once per analysis
 * over the union of files) and disjointness (trees never overlap their
 * neighbours' plots). Tree size class is fixed from a file's peak line count so
 * a file keeps its silhouette while its canopy grows and shrinks with history.
 */

import { Color } from 'three'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import { cityLayout, type CityLayout } from './treemap'
import { languageOf } from '../lib/languages'
import { buildColorer, type ColorMode } from '../city/colorModes'
import { TREE_KINDS, treeKindFor } from '../city/treeShapes'

export interface ForestModel {
  /** tree index → file path (same ordering contract as CityModel.paths) */
  paths: string[]
  indexOf: Map<string, number>
  /** xyz per tree (y = 0, trees stand on the ground) */
  positions: Float32Array
  /** index into TREE_KINDS (bush / tree / ancient), from peak line count */
  kinds: Uint8Array
  /** per-tree language color (satisfies colorModes' ColorContext) */
  langColors: Color[]
  /** grove id per tree (parent directory) */
  groveOf: Uint16Array
  /** the shared treemap layout, for grove ground patches */
  layout: CityLayout
  worldSize: number
}

export interface ForestTargets {
  /** per-tree target scale (0 = file absent at this snapshot → not yet grown) */
  scales: Float32Array
  /** per-tree rgb triplets */
  colors: Float32Array
}

/**
 * Growth factor for a present file. The kind already encodes the big steps
 * (bush/tree/ancient hulls differ a lot), so per-file scale only breathes
 * gently with the live line count.
 */
export function treeScaleFor(loc: number): number {
  return Math.min(1.7, Math.max(0.65, 0.7 + 0.22 * Math.log10(loc + 1)))
}

function pseudo(i: number): number {
  const s = Math.sin(i * 78.233) * 43758.5453
  return s - Math.floor(s)
}

export function buildForestModel(analysis: RepoAnalysis): ForestModel {
  // union weights, exactly like buildCityModel — peak LOC per path
  const weights = new Map<string, number>()
  for (const snap of analysis.snapshots) {
    for (const f of snap.files) {
      const w = Math.max(f.loc, 1)
      if ((weights.get(f.path) ?? 0) < w) weights.set(f.path, w)
    }
  }
  const files = Array.from(weights, ([path, weight]) => ({ path, weight }))
  const worldSize = Math.max(90, Math.min(300, Math.sqrt(files.length) * 10))

  const layout = cityLayout(files, worldSize)
  const paths = layout.plots.map((p) => p.path)
  const n = paths.length
  const positions = new Float32Array(n * 3)
  const kinds = new Uint8Array(n)
  const groveOf = new Uint16Array(n)

  const groveIds = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const { path, rect } = layout.plots[i]
    // stand the tree near the plot centre, nudged so groves don't read as a grid
    const jx = (pseudo(i * 2 + 1) - 0.5) * rect.w * 0.5
    const jz = (pseudo(i * 2 + 2) - 0.5) * rect.h * 0.5
    positions[i * 3] = rect.x + rect.w / 2 + jx
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = rect.y + rect.h / 2 + jz

    const w = weights.get(path) ?? 1
    kinds[i] = TREE_KINDS.indexOf(treeKindFor(w))

    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    let gid = groveIds.get(dir)
    if (gid === undefined) {
      gid = groveIds.size
      groveIds.set(dir, gid)
    }
    groveOf[i] = gid
  }

  const indexOf = new Map(paths.map((p, i) => [p, i]))
  const langColors = paths.map((p) => new Color(languageOf(p).color))
  return { paths, indexOf, positions, kinds, langColors, groveOf, layout, worldSize }
}

const scratch = new Color()

export function forestTargets(
  model: ForestModel,
  snapshot: Snapshot,
  colorMode: ColorMode
): ForestTargets {
  const n = model.paths.length
  const scales = new Float32Array(n)
  const colors = new Float32Array(n * 3)

  const byPath = new Map(snapshot.files.map((f) => [f.path, f]))
  const colorer = buildColorer(model, snapshot, colorMode)

  for (let i = 0; i < n; i++) {
    const f = byPath.get(model.paths[i])
    if (!f) continue
    scales[i] = treeScaleFor(f.loc)
    const c = colorer.colorFor(f, i, scratch)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  return { scales, colors }
}
