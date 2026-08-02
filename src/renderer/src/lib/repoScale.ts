import type { RepoSize } from '../../../shared/types'

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
 * Rough seconds to analyse, extrapolated linearly from a single measured point
 * (129.6s for 14,271 commits ≈ 9ms each). One data point is a weak basis, so
 * callers should present this as an order of magnitude and never as a countdown.
 */
export function estimateSeconds(commits: number): number {
  return (commits * 9) / 1000
}

export interface RepoWarning {
  size: RepoSize
  /** order-of-magnitude wait, already worded ("about a minute") */
  wait: string
  /** true once the road network is effectively gone */
  streetless: boolean
  dense: boolean
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
  const seconds = estimateSeconds(size.commits)
  const slow = seconds >= WARN_ABOVE_SECONDS
  const dense = size.files >= DENSE_FILE_COUNT
  if (!slow && !dense) return null
  return {
    size,
    wait: wordWait(seconds),
    streetless: size.files >= STREETLESS_FILE_COUNT,
    dense
  }
}
