import { useState } from 'react'
import { useStore } from '../store'

/**
 * Shown while a pull request is being "reviewed in the city": its changed files
 * glow with blue beacons in the scene. The banner names the PR, counts the
 * files, lets you step the camera through them, and exits the review.
 */
export default function ReviewBanner(): React.JSX.Element | null {
  const review = useStore((s) => s.review)
  const loading = useStore((s) => s.reviewLoading)
  const clearReview = useStore((s) => s.clearReview)
  const setSelected = useStore((s) => s.setSelected)
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

  const count = review.paths.length
  const step = (dir: number): void => {
    if (count === 0) return
    const next = (cursor + dir + count) % count
    setCursor(next)
    setSelected(review.paths[next])
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
