import type { RepoAnalysis } from '../../../shared/types'
import { peakLocByPath } from '../../../shared/snapshots'

/**
 * The layout's only input: peak line count per path, over the union of every
 * file that ever existed.
 *
 * Both model builders lay out from this and nothing else, which is what keeps a
 * building in one place while you scrub — it rises, shrinks and vanishes, but
 * the plot it stands on was decided by its peak, not by its size at the frame
 * on screen. Read straight off the columnar snapshots, so nothing is
 * materialized for it (#62).
 */
export function layoutWeights(analysis: RepoAnalysis): Map<string, number> {
  const weights = new Map<string, number>()
  for (const [path, peak] of peakLocByPath(analysis)) {
    // floor of 1: a file that only ever existed empty still gets a plot
    weights.set(path, Math.max(peak, 1))
  }
  return weights
}

/**
 * A short value that changes whenever these weights would lay out differently —
 * what the scene models are cached on, so a commit that did not move anything
 * keeps the city it already had (#69; see city/modelCache.ts).
 *
 * Combined with `+` and `^`, both commutative, so iteration order does not
 * matter — a full re-analysis and a splice intern their paths in different
 * orders and must still agree. The count goes in the string because commutative
 * accumulators alone cannot tell a set from one that cancels out, and the weight
 * is mixed into the path's hash rather than accumulated beside it, so two files
 * swapping sizes is not a no-op.
 */
export function layoutDigest(weights: Map<string, number>): string {
  let sum = 0
  let xor = 0
  for (const [path, weight] of weights) {
    let h = 2166136261 // FNV-1a over the path
    for (let i = 0; i < path.length; i++) {
      h = Math.imul(h ^ path.charCodeAt(i), 16777619)
    }
    // line counts are whole numbers, so the int32 coercion in `^` loses nothing
    h = Math.imul(h ^ weight, 2654435761)
    sum = (sum + h) | 0
    xor ^= h
  }
  return `${weights.size}:${sum >>> 0}:${xor >>> 0}`
}
