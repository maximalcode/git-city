import { useState } from 'react'
import { useStore } from '../store'
import { getMode } from '../city/modes'

/**
 * Shown while a pull request is being "reviewed in the city": its changed files
 * glow with blue beacons in the scene. The banner names the PR, counts the
 * files, lets you step the camera through them, and exits the review.
 */
export default function ReviewBanner({
  /**
   * The subset of the PR's files the scene can actually place. Files the PR
   * adds do not exist on this branch, so they never glow — and the ‹ › stepper
   * used to land on them with no camera move, no highlight and no message while
   * the counter insisted there were twelve (#30).
   */
  locatable
}: {
  locatable?: readonly string[]
}): React.JSX.Element | null {
  const review = useStore((s) => s.review)
  const loading = useStore((s) => s.reviewLoading)
  const clearReview = useStore((s) => s.clearReview)
  const setSelected = useStore((s) => s.setSelected)
  // "not in this branch's city" follows the active view, as elsewhere
  const noun = getMode(useStore((s) => s.viewMode)).noun
  const [cursor, setCursor] = useState(0)

  if (loading) {
    return (
      <div className="review-banner">
        <span className="spinner" />
        <span>Loading changed files…</span>
      </div>
    )
  }
  if (!review) return null

  // Step through — and count — only what the scene can show. `locatable` is
  // absent in the empty-repo case, where every path is unlocatable anyway.
  const shown = locatable ?? []
  const count = shown.length
  const elsewhere = review.paths.length - count
  const step = (dir: number): void => {
    if (count === 0) return
    const next = (cursor + dir + count) % count
    setCursor(next)
    setSelected(shown[next])
  }

  return (
    <div className="review-banner">
      <span className="review-dot" />
      <span className="review-text">
        Reviewing <strong>#{review.number}</strong>
        <span className="review-title"> {review.title}</span>
      </span>
      {/* "0 files" used to be asserted whenever the fetch failed — a confident
          claim that the PR changes nothing (#24) */}
      {review.error ? (
        <span className="review-count review-error">{review.error}</span>
      ) : (
        <span className="review-count">
          {count} file{count === 1 ? '' : 's'}
          {elsewhere > 0 && (
            <span className="review-elsewhere">
              {' · '}
              {elsewhere} not in this branch&apos;s {noun} yet
            </span>
          )}
        </span>
      )}
      {count > 0 && (
        <span className="review-step">
          <button onClick={() => step(-1)} aria-label="Previous file">
            ‹
          </button>
          <button onClick={() => step(1)} aria-label="Next file">
            ›
          </button>
        </span>
      )}
      <button className="review-exit" onClick={clearReview}>
        Exit
      </button>
    </div>
  )
}
