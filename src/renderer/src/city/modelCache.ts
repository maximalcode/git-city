import type { RepoAnalysis } from '../../../shared/types'
import { layoutDigest, layoutWeights } from '../layout/weights'

/**
 * Memoisation for the scene models, keyed on what the layout is computed from.
 *
 * The models used to be cached on the analysis *object*, and a re-analysis
 * hands back a fresh one after every commit — so every commit missed and rebuilt
 * the treemap. Plot positions come out of a squarified treemap over the weights,
 * so that moved 49,365 of 81,368 plots, max displacement 10.66 units on a
 * 280-unit city (#69): one commit rearranged most of the city, which is the
 * single property the layout exists to protect.
 */

/**
 * What an analysis lays out to, memoised on the analysis object.
 *
 * `prepare` runs on every scrub step, so this has to be a lookup rather than a
 * measurement in the common case. Identity is the wrong key for a model and the
 * right one here: an analysis object cannot change what it weighs.
 */
const digestCache = new WeakMap<RepoAnalysis, string>()

export function layoutKey(analysis: RepoAnalysis): string {
  let key = digestCache.get(analysis)
  if (key === undefined) {
    key = layoutDigest(layoutWeights(analysis))
    digestCache.set(analysis, key)
  }
  return key
}

/**
 * Wrap a model builder so an analysis that lays out identically reuses the
 * model already built.
 *
 * Weights determine plot geometry. Farm crop classes use raw peak lines, but
 * square-root compression is strictly increasing for positive line counts, so
 * every class transition changes the digest too. Empty and one-line files share
 * both a weight and a crop class. Two repos that happen to weigh the same may
 * legitimately share a model. If a model ever
 * gains a field that is *not* derived from the weights, that stops being true
 * and this key has to grow to cover it.
 *
 * A digest collision would hand back a model laid out for different weights:
 * buildings in the wrong places, silently. Two 32-bit accumulators and the
 * entry count make that vanishingly unlikely, and nothing here can detect it,
 * so it is worth knowing that is the failure being traded against a treemap.
 *
 * Held through a WeakRef, one entry deep. Strongly, the last city built would
 * stay reachable for the rest of the process — including after the repo is
 * closed and the scene unmounted, which is exactly what the old WeakMap got
 * right. While the scene is mounted it holds the model itself, so the reference
 * resolves; once nothing is drawing it, it goes. A collection between two
 * renders costs a rebuild, never a wrong answer.
 */
export function cacheByLayout<T extends object>(
  build: (analysis: RepoAnalysis) => T
): (analysis: RepoAnalysis) => T {
  let key: string | null = null
  let ref: WeakRef<T> | null = null
  return (analysis) => {
    const k = layoutKey(analysis)
    const kept = k === key ? ref?.deref() : undefined
    if (kept) return kept
    const model = build(analysis)
    key = k
    ref = new WeakRef(model)
    return model
  }
}
