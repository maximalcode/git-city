import type { RepoSize } from '../../../shared/types'
import { MAX_DRAWN_FILES } from '../layout/cap'

/**
 * Whether a repository is big enough to be worth warning about before opening.
 *
 * Both limits come from the measurements in #12, taken against a full
 * microsoft/TypeScript checkout (14,271 first-parent commits, 81,368 files):
 * analysis took 129.6s, and the treemap emitted 17,625 road segments at 20,000
 * files but only 8 at 81,368 — past a certain density the plots are too small
 * to clear MIN_ROAD_WIDTH and the streets simply stop being drawn.
 */

/** Above this the city gets dense and the streets start thinning out. */
export const DENSE_FILE_COUNT = 20_000
/** Above this the road network has collapsed to almost nothing. */
export const STREETLESS_FILE_COUNT = 60_000
/** Below this the wait is short enough not to be worth interrupting anyone for. */
const WARN_ABOVE_SECONDS = 25

/**
 * Rough seconds before the scene is on screen.
 *
 * Two costs, and the second one used to be missing entirely — the estimate
 * counted only the history replay, so for a TypeScript-sized monorepo it
 * promised "a couple of minutes" for a wait of over three and a half (#12).
 *
 * - **analysis**, linear in commits: 129.6s for 14,271 ≈ 9ms each.
 * - **scene build**, in the renderer: 4.9s at 5,000 files and 16.7s at 20,000
 *   on a cold load, so roughly 0.8ms per drawn file. Bounded, because
 *   {@link MAX_DRAWN_FILES} means the explosive tail past 20k is never paid —
 *   uncapped, 81,368 files took 212s.
 *
 * Both are extrapolations from few points, so callers must present the result
 * as an order of magnitude and never as a countdown.
 */
export function estimateSeconds(commits: number, files = 0): number {
  const analysis = (commits * 9) / 1000
  const drawn = Math.min(files, MAX_DRAWN_FILES)
  const scene = (drawn * 0.8) / 1000
  return analysis + scene
}

export interface RepoWarning {
  size: RepoSize
  /** order-of-magnitude wait, already worded ("about a minute") */
  wait: string
  /** true once the road network is effectively gone */
  streetless: boolean
  dense: boolean
  /** the scene will show a subset of the files */
  capped: boolean
  /** how many will actually be drawn */
  drawn: number
}

function wordWait(seconds: number): string {
  if (seconds < 90) return 'up to a minute'
  if (seconds < 210) return 'a couple of minutes'
  if (seconds < 600) return 'several minutes'
  return 'a long time — possibly over ten minutes'
}

/**
 * The warning for a repo, or null when it will open comfortably. Slowness and
 * density are independent: a long history is slow but draws fine, and a huge
 * flat tree draws badly but may replay quickly.
 */
export function repoWarning(size: RepoSize): RepoWarning | null {
  const seconds = estimateSeconds(size.commits, size.files)
  const slow = seconds >= WARN_ABOVE_SECONDS
  const dense = size.files >= DENSE_FILE_COUNT
  if (!slow && !dense) return null
  return {
    size,
    wait: wordWait(seconds),
    streetless: size.files >= STREETLESS_FILE_COUNT,
    dense,
    // above the cap the scene is a subset, and the dialog has to say so before
    // they commit to the wait — not after (#12)
    capped: size.files > MAX_DRAWN_FILES,
    drawn: Math.min(size.files, MAX_DRAWN_FILES)
  }
}
