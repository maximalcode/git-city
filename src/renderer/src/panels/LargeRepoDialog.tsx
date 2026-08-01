import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { DENSE_FILE_COUNT } from '../lib/repoScale'

/**
 * Shown before opening a repository big enough to be worth a heads-up.
 *
 * A full history replay on a monorepo runs for minutes, and a progress bar with
 * no sense of scale reads as a hang — people quit and conclude the app is
 * broken. Saying what is coming turns that into an informed choice. See #12.
 */
export default function LargeRepoDialog(): React.JSX.Element | null {
  const pending = useStore((s) => s.pendingRepo)
  const confirmOpen = useStore((s) => s.confirmPendingRepo)
  const cancel = useStore((s) => s.cancelPendingRepo)
  const openRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pending) return
    openRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancel()
      } else if (e.key === 'Enter') {
        e.stopPropagation()
        void confirmOpen()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, confirmOpen, cancel])

  if (!pending) return null
  const { size, wait, dense, streetless } = pending.warning

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-label="Large repository"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>This is a big repository</h3>
        <p>
          {size.files.toLocaleString()} files and {size.commits.toLocaleString()} commits. Reading
          the history takes {wait}, and it cannot be paused once it starts.
        </p>
        {dense && (
          <p>
            {streetless
              ? 'At this size the streets stop being drawn entirely — the plots are too small to fit a road between them, so expect a dense block of buildings rather than a city.'
              : `Above about ${DENSE_FILE_COUNT.toLocaleString()} files the city gets dense and the streets start to thin out.`}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={cancel}>Cancel</button>
          <button ref={openRef} className="primary" onClick={() => void confirmOpen()}>
            Open anyway
          </button>
        </div>
      </div>
    </div>
  )
}
