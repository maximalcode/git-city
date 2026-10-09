import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  RehearsalReport,
  RehearsalReviewEntry,
  RehearsalReviewFileResult,
  RehearsalReviewFileView
} from '../../../shared/types'
import { bridge } from '../lib/bridge'
import { useRepoQuery } from '../lib/repoQuery'

function name(entry: RehearsalReviewEntry): string {
  if (entry.oldPath && entry.newPath && entry.oldPath !== entry.newPath)
    return `${entry.oldPath} → ${entry.newPath}`
  return entry.newPath ?? entry.oldPath ?? '(unnamed entry)'
}

function status(entry: RehearsalReviewEntry): string {
  if (entry.change === 'added') return 'Added'
  if (entry.change === 'deleted') return 'Deleted'
  if (entry.change === 'typechange') return 'Type changed'
  return entry.binary ? 'Binary' : 'Modified'
}

function Hunks({ file }: { file: RehearsalReviewFileResult }): React.JSX.Element {
  if (file.hunks.length === 0) return <p className="empty">No text changes to show.</p>
  return (
    <div className="rehearsal-review-hunks">
      {file.hunks.map((hunk, index) => (
        <div className="diff-hunk" key={`${hunk.header}:${index}`}>
          <div className="diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, lineIndex) => (
            <div className={`diff-line diff-${line.kind}`} key={lineIndex}>
              <span className="diff-gutter">
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
              </span>
              <span className="diff-text">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function RehearsalReviewPanel({
  report
}: {
  report: RehearsalReport
}): React.JSX.Element {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [view, setView] = useState<RehearsalReviewFileView>('changes')
  const [filter, setFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')
  const [fileCursor, setFileCursor] = useState<string | null>(null)
  const [fileEntries, setFileEntries] = useState<RehearsalReviewEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const previousRevision = useRef<string | null>(null)
  const api = bridge()
  const { id, repository, repository_id, origin_worktree } = report
  const reviewIdentity = useMemo(
    () => ({ id, repository, repository_id, origin_worktree }),
    [id, repository, repository_id, origin_worktree]
  )
  const key = useMemo(
    () =>
      JSON.stringify([
        report.id,
        report.repository_id,
        report.sandbox,
        report.refs,
        report.outcome,
        report.carried
      ]),
    [report]
  )
  const summaryQuery = useRepoQuery(
    api?.rehearsalReviewSummary ? ([reviewIdentity, key] as const) : null,
    (client, [request]) => client.rehearsalReviewSummary(request)
  )
  const summary = summaryQuery.loading ? null : summaryQuery.data
  const scopeId = summary?.defaultScopeId ?? null
  const filesQuery = useRepoQuery(
    summary && scopeId
      ? ([reviewIdentity, summary.reviewRevision, scopeId, fileCursor, appliedFilter] as const)
      : null,
    (client, [request, revision, scope, cursor, filterValue]) =>
      client.rehearsalReviewFiles(request, revision, scope, cursor ?? undefined, filterValue)
  )
  const files = filesQuery.loading ? null : filesQuery.data
  const selected = fileEntries.find((entry) => entry.entryId === selectedEntryId) ?? null
  const fileQuery = useRepoQuery(
    summary && scopeId && selected
      ? ([reviewIdentity, summary.reviewRevision, scopeId, selected.entryId, view] as const)
      : null,
    (client, [request, revision, scope, entryId, selectedView]) =>
      client.rehearsalReviewFile(request, revision, scope, entryId, selectedView)
  )
  const file = fileQuery.loading ? null : fileQuery.data
  const loading = summaryQuery.loading || filesQuery.loading || fileQuery.loading
  const error = summaryQuery.error || filesQuery.error || fileQuery.error

  // Replacing a report revision invalidates the inventory and pending content,
  // while a harmless refresh keeps a surviving selection by entry ID.
  useEffect(() => {
    if (
      summary?.reviewRevision &&
      previousRevision.current &&
      previousRevision.current !== summary.reviewRevision
    )
      setSelectedEntryId(null)
    previousRevision.current = summary?.reviewRevision ?? previousRevision.current
    setFileCursor(null)
    setFileEntries([])
    setNextCursor(null)
  }, [summary?.reviewRevision, scopeId, appliedFilter])

  useEffect(() => {
    if (!files || filesQuery.loading) return
    setFileEntries((current) => (fileCursor ? [...current, ...files.entries] : files.entries))
    setNextCursor(files.nextCursor)
    setSelectedEntryId((current) => {
      if (current) return current
      return files.entries[0]?.entryId ?? null
    })
  }, [files, filesQuery.loading, fileCursor])

  const loadFiles = (nextFilter: string): void => {
    setAppliedFilter(nextFilter)
    setFileCursor(null)
  }

  const loadMore = (): void => {
    if (nextCursor) setFileCursor(nextCursor)
  }

  const choose = (entry: RehearsalReviewEntry): void => {
    setSelectedEntryId(entry.entryId)
    setView('changes')
  }

  const selectView = (nextView: RehearsalReviewFileView): void => {
    setView(nextView)
  }

  return (
    <section className="rehearsal-review-panel" aria-label="Frozen rehearsal review">
      <div className="rehearsal-review-heading">
        <h3>Frozen file review</h3>
        <button onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? 'Hide file review' : 'Review changed files'}
        </button>
      </div>
      {expanded && (
        <>
          {loading && <p role="status">Loading retained review…</p>}
          {error && <p role="alert">⚠ {error}</p>}
          {summary && (
            <>
              <p className="rehearsal-review-notice">{summary.notices[0]}</p>
              {!summary.afterAvailable && <p role="alert">⚠ {summary.afterReason}</p>}
              <label>
                Filter files
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') loadFiles(filter)
                  }}
                  placeholder="Path contains…"
                />
              </label>
              <div className="rehearsal-review-layout">
                <div className="rehearsal-review-files" role="listbox" aria-label="Changed files">
                  <p>{files?.total ?? fileEntries.length} changed files</p>
                  {fileEntries.map((entry) => (
                    <button
                      role="option"
                      aria-selected={selected?.entryId === entry.entryId}
                      className="rehearsal-review-file"
                      key={entry.entryId}
                      onClick={() => choose(entry)}
                    >
                      <span>{name(entry)}</span>
                      <small>{status(entry)}</small>
                    </button>
                  ))}
                  {nextCursor && (
                    <button onClick={loadMore} disabled={loading}>
                      Load more files
                    </button>
                  )}
                  {files && files.entries.length === 0 && (
                    <p className="empty">No changes in this scope.</p>
                  )}
                </div>
                <div className="rehearsal-review-content" aria-live="polite">
                  {selected && (
                    <>
                      <h4>{name(selected)}</h4>
                      <div role="tablist" aria-label="Frozen file view">
                        {(['changes', 'before', 'after'] as const).map((candidate) => (
                          <button
                            role="tab"
                            aria-selected={view === candidate}
                            disabled={candidate === 'after' && !summary.afterAvailable}
                            key={candidate}
                            onClick={() => selectView(candidate)}
                          >
                            {candidate[0].toUpperCase() + candidate.slice(1)}
                          </button>
                        ))}
                      </div>
                      {file &&
                        file.availability !== 'available' &&
                        file.availability !== 'absent' && (
                          <p role="status">
                            {file.availability === 'binary'
                              ? 'Binary file — no text content.'
                              : `Content ${file.availability}.`}
                          </p>
                        )}
                      {file?.availability === 'absent' && (
                        <p className="empty">This side is absent.</p>
                      )}
                      {file?.text !== null && file?.text !== undefined && <pre>{file.text}</pre>}
                      {view === 'changes' && file && <Hunks file={file} />}
                    </>
                  )}
                  {!selected && (
                    <p className="empty">Select a changed file to inspect its retained content.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
