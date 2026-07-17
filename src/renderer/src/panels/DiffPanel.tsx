import { useEffect, useState } from 'react'
import type { DiffFile } from '../../../shared/types'
import { cleanError, hasApi, isLiveState, useStore } from '../store'

/**
 * Shows the diff for the selected building's file. Context-aware: when viewing
 * the latest state it shows uncommitted changes (falling back to the file's
 * last change); when scrubbed back in the timeline it shows the change that
 * commit introduced.
 */
export default function DiffPanel(): React.JSX.Element | null {
  const diffOpen = useStore((s) => s.diffOpen)
  const selected = useStore((s) => s.selected)
  const repoPath = useStore((s) => s.repoPath)
  const analysis = useStore((s) => s.analysis)
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const live = useStore(isLiveState)
  const diffRev = useStore((s) => s.diffRev)
  const setDiffOpen = useStore((s) => s.setDiffOpen)

  const [diff, setDiff] = useState<DiffFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // An explicit rev (opened from a history commit) wins over the timeline context.
  const rev = diffRev ?? (!live && analysis ? analysis.snapshots[snapshotIndex]?.hash : undefined)

  useEffect(() => {
    if (!diffOpen || !selected || !repoPath || !hasApi()) {
      setDiff(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.gitCity
      .getFileDiff(repoPath, selected, rev)
      .then((d) => {
        if (!cancelled) setDiff(d)
      })
      .catch((err) => {
        if (!cancelled) {
          setDiff(null)
          setError(cleanError(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [diffOpen, selected, repoPath, rev, retryNonce])

  if (!diffOpen || !selected) return null

  return (
    <div className="diff-panel">
      <div className="panel-head">
        <div className="diff-head-text">
          <span className="diff-path">{selected}</span>
          {diff && (
            <span className="diff-meta">
              {diff.title}
              {!diff.binary && (
                <>
                  {' · '}
                  <span className="diff-add">+{diff.additions}</span>{' '}
                  <span className="diff-del">−{diff.deletions}</span>
                </>
              )}
            </span>
          )}
        </div>
        <button className="close" aria-label="Close" onClick={() => setDiffOpen(false)}>
          ✕
        </button>
      </div>

      <div className="diff-body">
        {loading && <div className="empty">Loading diff…</div>}
        {!loading && error && (
          <div className="panel-error">
            <span>{error}</span>
            <button onClick={() => setRetryNonce((n) => n + 1)}>Retry</button>
          </div>
        )}
        {!loading && diff && diff.binary && (
          <div className="empty">Binary file — no line diff.</div>
        )}
        {!loading && diff && !diff.binary && diff.hunks.length === 0 && (
          <div className="empty">No changes to show.</div>
        )}
        {!loading &&
          diff &&
          diff.hunks.map((h, hi) => (
            <div key={hi} className="diff-hunk">
              <div className="diff-hunk-header">{h.header}</div>
              {h.lines.map((l, li) => (
                <div key={li} className={`diff-line diff-${l.kind}`}>
                  <span className="diff-gutter">
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                  </span>
                  <span className="diff-text">{l.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  )
}
