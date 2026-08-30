import { useMemo } from 'react'
import type { DiffHunk, DiffLine, ImageDiff } from '../../../shared/types'
import type { DiffFile } from '../../../shared/types'
import { useRepoQuery } from '../lib/repoQuery'
import { isLiveState, useStore } from '../store'
import { pairedWordSpans, toSideBySide, type SbsCell, type WordSpan } from '../lib/wordDiff'
import { isImagePath } from '../../../shared/imageExt'

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

  // An explicit rev (opened from a history commit) wins over the timeline context.
  const rev = diffRev ?? (!live && analysis ? analysis.snapshots[snapshotIndex]?.hash : undefined)

  const { data, loading, error, reload } = useRepoQuery(
    diffOpen && selected && repoPath ? ([repoPath, selected, rev ?? null] as const) : null,
    async (api, [repo, path, at]): Promise<{ diff: DiffFile; image: ImageDiff | null }> => {
      const diff = await api.getFileDiff(repo, path, at ?? undefined)
      // a binary image → fetch the before/after bytes for a visual diff
      const image =
        diff.binary && isImagePath(path)
          ? await api.imageDiff(repo, path, at ?? undefined).catch(() => null)
          : null
      return { diff, image }
    }
  )
  const diff = data?.diff ?? null
  const imgDiff = data?.image ?? null

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
            <button onClick={reload}>Retry</button>
          </div>
        )}
        {!loading && diff && diff.binary && imgDiff && (imgDiff.old || imgDiff.new) && (
          <ImageDiffView diff={imgDiff} />
        )}
        {!loading && diff && diff.binary && !(imgDiff && (imgDiff.old || imgDiff.new)) && (
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Side-by-side before/after view for a changed image. */
function ImageDiffView({ diff }: { diff: ImageDiff }): React.JSX.Element {
  const oldB = diff.old?.bytes ?? 0
  const newB = diff.new?.bytes ?? 0
  const delta = newB - oldB
  return (
    <div className="img-diff">
      <div className="img-side">
        <div className="img-label del">Before</div>
        {diff.old ? (
          <img src={diff.old.dataUri} alt="before" />
        ) : (
          <div className="img-absent">added</div>
        )}
        <div className="img-bytes">{diff.old ? formatBytes(diff.old.bytes) : '—'}</div>
      </div>
      <div className="img-side">
        <div className="img-label add">After</div>
        {diff.new ? (
          <img src={diff.new.dataUri} alt="after" />
        ) : (
          <div className="img-absent">deleted</div>
        )}
        <div className="img-bytes">
          {diff.new ? formatBytes(diff.new.bytes) : '—'}
          {diff.old && diff.new && (
            <span className={`img-delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '+' : '−'}
              {formatBytes(Math.abs(delta))}
            </span>
          )}
        </div>
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
