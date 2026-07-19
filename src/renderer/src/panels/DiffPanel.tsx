import { useEffect, useMemo, useState } from 'react'
import type { DiffHunk, DiffLine } from '../../../shared/types'
import type { DiffFile } from '../../../shared/types'
import { cleanError, hasApi, isLiveState, useStore } from '../store'
import { pairedWordSpans, toSideBySide, type SbsCell, type WordSpan } from '../lib/wordDiff'

/**
 * Shows the diff for the selected building's file. Context-aware: when viewing
 * the latest state it shows uncommitted changes (falling back to the file's
 * last change); when scrubbed back in the timeline it shows the change that
 * commit introduced. Renders unified or side-by-side (persisted), both with
 * word-level intra-line highlighting.
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
  const split = useStore((s) => s.diffSplit)
  const toggleSplit = useStore((s) => s.toggleDiffSplit)

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

  const showToggle = !!diff && !diff.binary && diff.hunks.length > 0

  return (
    <div className={`diff-panel${split ? ' split' : ''}`}>
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
        <div className="diff-head-actions">
          {showToggle && (
            <button
              className="diff-layout-toggle"
              onClick={toggleSplit}
              title={split ? 'Switch to unified view' : 'Switch to side-by-side view'}
            >
              {split ? 'Unified' : 'Split'}
            </button>
          )}
          <button className="close" aria-label="Close" onClick={() => setDiffOpen(false)}>
            ✕
          </button>
        </div>
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
          !diff.binary &&
          diff.hunks.map((h, hi) =>
            split ? <SplitHunk key={hi} hunk={h} /> : <UnifiedHunk key={hi} hunk={h} />
          )}
      </div>
    </div>
  )
}

/** Render a possibly word-diffed line body: highlighted spans, or plain text. */
function LineBody({ text, spans }: { text: string; spans: WordSpan[] | null }): React.JSX.Element {
  if (!spans) return <span className="diff-text">{text || ' '}</span>
  return (
    <span className="diff-text">
      {spans.map((s, i) =>
        s.changed ? (
          <span key={i} className="wd">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </span>
  )
}

function UnifiedHunk({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  const spans = useMemo(() => pairedWordSpans(hunk.lines), [hunk])
  return (
    <div className="diff-hunk">
      <div className="diff-hunk-header">{hunk.header}</div>
      {hunk.lines.map((l: DiffLine, li) => (
        <div key={li} className={`diff-line diff-${l.kind}`}>
          <span className="diff-gutter">
            {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
          </span>
          <LineBody text={l.text} spans={spans[li]} />
        </div>
      ))}
    </div>
  )
}

function SplitCell({ cell }: { cell: SbsCell }): React.JSX.Element {
  return (
    <div className={`diff-line diff-${cell.kind}`}>
      <span className="diff-gutter">
        {cell.kind === 'add' ? '+' : cell.kind === 'del' ? '−' : ' '}
      </span>
      {cell.kind === 'empty' ? (
        <span className="diff-text" />
      ) : (
        <LineBody text={cell.text} spans={cell.spans} />
      )}
    </div>
  )
}

function SplitHunk({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  const rows = useMemo(() => toSideBySide(hunk.lines), [hunk])
  return (
    <div className="diff-hunk">
      <div className="diff-hunk-header">{hunk.header}</div>
      <div className="diff-split-grid">
        {rows.map((r, ri) => (
          <div key={ri} className="diff-split-row">
            <SplitCell cell={r.left} />
            <SplitCell cell={r.right} />
          </div>
        ))}
      </div>
    </div>
  )
}
