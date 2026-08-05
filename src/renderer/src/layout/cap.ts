import type { CityInput } from './treemap'

/**
 * The ceiling on how many files get drawn.
 *
 * Measured in the renderer preview against the synthetic mock (`?mock=N`),
 * cold page load each time, from navigation start to the scene being
 * interactive — the timestamp CameraRig records as `__gitCitySceneReadyMs` (#12):
 *
 * |            files | ready | heap |
 * | ---------------: | ----: | ---: |
 * |            5,000 |  4.9s | 80MB |
 * |           20,000 | 16.7s | 89MB |
 * | 81,368 uncapped  | 212.4s | 242MB+ |
 * | 81,368 capped    | 20–29s | 184MB |
 *
 * Three and a half minutes, during which the main thread is pegged hard enough
 * that the tab stops answering at all. The cap takes that to well under half a
 * minute — roughly an order of magnitude. (The capped figure varies run to run
 * with what else the machine is doing; the uncapped one is not close enough to
 * the line for that to matter.)
 *
 * 20,000 is the knee. It is where the treemap also turns super-linear (218ms →
 * 3,059ms out to 81k), and it is past the point where the street network
 * survives: above ~60k files the plots are too small to clear MIN_ROAD_WIDTH
 * and the roads stop being drawn at all. So the buildings beyond the cap were
 * costing three minutes to render a picture that had already stopped being a
 * city.
 */
export const MAX_DRAWN_FILES = 20_000

export interface CappedFiles {
  files: CityInput[]
  /** how many the repository actually has */
  total: number
  /** true when files were left out */
  capped: boolean
}

/**
 * Keep the largest `max` files and say how many were dropped.
 *
 * Ranked by weight, which both model builders define as a path's *peak* line
 * count across the whole history — not its size in the current snapshot. That
 * matters: the set has to be identical for every frame of the timeline, or
 * buildings would appear and vanish as you scrub, which is exactly the property
 * the layout is built to avoid.
 *
 * Ties break on path so the result is deterministic; two runs over the same
 * repository must lay out identically.
 */
export function capFiles(files: CityInput[], max = MAX_DRAWN_FILES): CappedFiles {
  const total = files.length
  if (total <= max) return { files, total, capped: false }
  const sorted = [...files].sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path))
  return { files: sorted.slice(0, max), total, capped: true }
}

/** "20,000 of 81,368 files" — what the HUD says when the cap bit. */
export function cappedLabel(shown: number, total: number): string {
  return `${shown.toLocaleString()} of ${total.toLocaleString()} files`
}
