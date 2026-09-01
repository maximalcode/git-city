/**
 * Farm layout — the "fields by folder" view of a repository.
 *
 * Every file is a cultivated field, every directory a farm parcel. Rectangles
 * come from the same squarified treemap the city uses, so the farm inherits its
 * two load-bearing properties: stability across snapshots (built once per
 * analysis over the union of files) and disjointness (fields never overlap).
 *
 * Where the city encodes line count as building height, the farm encodes it as
 * how far the crop has grown — a young file is bare tilled soil, a large one is
 * a full standing crop. The crop *kind* is fixed from a file's peak line count,
 * so a field keeps its character while the crop rises and falls with history.
 */

import { Color } from 'three'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import { peakLocByPath } from '../../../shared/snapshots'
import { layoutWeights } from './weights'
import { cityLayout, type CityLayout, type Rect } from './treemap'
import { buildRoadGraph, type RoadGraph } from './roads'
import { capFiles } from './cap'
import { languageOf } from '../lib/languages'
import { buildColorer, type ColorMode } from '../city/colorModes'

/** Crop classes, smallest to largest. Index into this from `kinds`. */
export const CROP_KINDS = ['furrow', 'row', 'orchard'] as const
export type CropKind = (typeof CROP_KINDS)[number]

/** Which crop a file grows, from its peak line count. */
export function cropKindFor(peakLoc: number): CropKind {
  if (peakLoc < 120) return 'furrow'
  if (peakLoc < 1200) return 'row'
  return 'orchard'
}

export interface FarmModel {
  /** field index → file path (same ordering contract as CityModel.paths) */
  paths: string[]
  indexOf: Map<string, number>
  /** the field rectangle per file, straight from the treemap */
  rects: Rect[]
  /** xz centre per field, flattened (y is implied 0 — fields lie on the ground) */
  centers: Float32Array
  /** index into CROP_KINDS, from peak line count */
  kinds: Uint8Array
  /** per-field language color (satisfies colorModes' ColorContext) */
  langColors: Color[]
  /** parcel id per field (parent directory) */
  parcelOf: Uint16Array
  /** the shared treemap layout, for parcel ground, fences and tracks */
  layout: CityLayout
  /**
   * The dirt-track graph, same construction as the city's streets. The farm
   * always laid the tracks and then left them empty (#52).
   */
  roadGraph: RoadGraph
  /** the parcels that get a farmstead — the top-level directories */
  steads: { rect: Rect; parcel: number }[]
  worldSize: number
  /** files the repository has, which is more than `paths` when capped (#12) */
  totalFiles: number
  capped: boolean
}

export interface FarmTargets {
  /** per-field crop height (0 = file absent at this snapshot → bare soil) */
  heights: Float32Array
  /** per-field rgb triplets */
  colors: Float32Array
}

/**
 * Crop height for a present file, in world units.
 *
 * Logarithmic: a 5,000-line file is not fifty times more interesting than a
 * 100-line one, and a linear
 * scale would leave everything else as stubble.
 */
export function cropHeightFor(loc: number): number {
  return Math.min(3.2, Math.max(0.12, 0.28 * Math.log10(loc + 1) ** 1.6))
}

export function buildFarmModel(analysis: RepoAnalysis): FarmModel {
  // the same union weights the city lays out from
  const weights = layoutWeights(analysis)
  const peaks = peakLocByPath(analysis)
  // same ceiling as the city — a monorepo's fields are unreadable long before
  // the scene finishes building, so draw the largest and say so (#12)
  const { files, total, capped } = capFiles(
    Array.from(weights, ([path, weight]) => ({ path, weight }))
  )
  // wider than the city: fields need room to read as fields, and the
  // farm is meant to feel like it goes on
  const worldSize = Math.max(110, Math.min(340, Math.sqrt(files.length) * 12))

  const layout = cityLayout(files, worldSize)
  const roadGraph = buildRoadGraph(layout.roads)
  const paths = layout.plots.map((p) => p.path)
  const n = paths.length
  const rects = layout.plots.map((p) => p.rect)
  const centers = new Float32Array(n * 2)
  const kinds = new Uint8Array(n)
  const parcelOf = new Uint16Array(n)

  const parcelIds = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const { path, rect } = layout.plots[i]
    centers[i * 2] = rect.x + rect.w / 2
    centers[i * 2 + 1] = rect.y + rect.h / 2

    kinds[i] = CROP_KINDS.indexOf(cropKindFor(peaks.get(path) ?? 1))

    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    let pid = parcelIds.get(dir)
    if (pid === undefined) {
      pid = parcelIds.size
      parcelIds.set(dir, pid)
    }
    parcelOf[i] = pid
  }

  // one farmstead per top-level directory — barns scattered across the whole
  // holding rather than a single farmhouse, which is what makes it read as big
  const steads = layout.districts
    .filter((d) => d.depth === 1)
    .map((d, i) => ({ rect: d.rect, parcel: i }))

  const indexOf = new Map(paths.map((p, i) => [p, i]))
  const langColors = paths.map((p) => new Color(languageOf(p).color))
  return {
    paths,
    indexOf,
    rects,
    centers,
    kinds,
    langColors,
    parcelOf,
    layout,
    roadGraph,
    steads,
    worldSize,
    totalFiles: total,
    capped
  }
}

const scratch = new Color()

export function farmTargets(
  model: FarmModel,
  snapshot: Snapshot,
  colorMode: ColorMode
): FarmTargets {
  const n = model.paths.length
  const heights = new Float32Array(n)
  const colors = new Float32Array(n * 3)

  const byPath = new Map(snapshot.files.map((f) => [f.path, f]))
  const colorer = buildColorer(model, snapshot, colorMode)

  for (let i = 0; i < n; i++) {
    const f = byPath.get(model.paths[i])
    if (!f) continue
    heights[i] = cropHeightFor(f.loc)
    const c = colorer.colorFor(f, i, scratch)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  return { heights, colors }
}
