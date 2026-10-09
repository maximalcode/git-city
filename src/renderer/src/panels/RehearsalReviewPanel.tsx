import { useEffect, useMemo, useRef, useState } from 'react'
import { RehearsalReviewScopeSelector } from './RehearsalReviewScopeSelector'
import RehearsalCityComparison from './RehearsalCityComparison'
import type {
  RehearsalReport,
  RehearsalReviewEntry,
  RehearsalReviewFileResult,
  RehearsalReviewFileView,
  RehearsalReviewIdentity
} from '../../../shared/types'
export {
  RehearsalReviewScopeSelector,
  type RehearsalReviewScopeSelectorProps
} from './RehearsalReviewScopeSelector'
import { bridge } from '../lib/bridge'
import { useRepoQuery } from '../lib/repoQuery'
import { useStore } from '../store'
import { reviewChangeLabel, reviewEntryMarkers, reviewEntryPaths } from '../city/rehearsalMarkers'
import {
  authoritativeRehearsalReviewTotal,
  validateRehearsalReviewFileResponse,
  validateRehearsalReviewFilesResponse,
  validateRehearsalReviewSummaryResponse
} from '../lib/rehearsalReviewResponses'

function name(entry: RehearsalReviewEntry): string {
  if (entry.oldPath && entry.newPath && entry.oldPath !== entry.newPath)
    return `${entry.oldPath} → ${entry.newPath}`
  return entry.newPath ?? entry.oldPath ?? '(unnamed entry)'
}

function status(entry: RehearsalReviewEntry): string {
  if (entry.change === 'modified' && entry.binary) return 'Binary'
  return reviewChangeLabel(entry.change)
}

export interface RehearsalReviewFileInventoryProps {
  identity: RehearsalReviewIdentity
  reviewRevision: string
  scopeId: string
  entries: RehearsalReviewEntry[]
  selectedEntryId: string | null
  total: number | null
  nextCursor: string | null
  filter: string
  loading: boolean
  onFilterChange: (filter: string) => void
  onApplyFilter: () => void
  onSelectEntry: (entryId: string) => void
  onLoadMore: () => void
}

/** Controlled, complete-inventory presentation seam for the later workspace. */
export function RehearsalReviewFileInventory({
  entries,
  selectedEntryId,
  total,
  nextCursor,
  filter,
  loading,
  onFilterChange,
  onApplyFilter,
  onSelectEntry,
  onLoadMore
}: RehearsalReviewFileInventoryProps): React.JSX.Element {
  return (
    <div className="rehearsal-review-inventory">
      <label>
        Filter files
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApplyFilter()
          }}
          placeholder="Path contains…"
        />
      </label>
      <div className="rehearsal-review-files" role="listbox" aria-label="Changed files">
        <p>{total === null ? 'Changed file count unavailable' : `${total} changed files`}</p>
        {entries.map((entry) => (
          <button
            role="option"
            aria-selected={selectedEntryId === entry.entryId}
            className="rehearsal-review-file"
            key={entry.entryId}
            disabled={loading}
            onClick={() => onSelectEntry(entry.entryId)}
          >
            <span>{name(entry)}</span>
            <small>{status(entry)}</small>
          </button>
        ))}
        {nextCursor && (
          <button onClick={onLoadMore} disabled={loading}>
            Load more files
          </button>
        )}
        {total === 0 && entries.length === 0 && <p className="empty">No changes in this scope.</p>}
      </div>
    </div>
  )
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

function contentStatus(file: RehearsalReviewFileResult): string {
  const beforeMode = file.entry.old.present ? (file.entry.old.mode ?? 'unknown') : 'absent'
  const afterMode = file.entry.new.present ? (file.entry.new.mode ?? 'unknown') : 'absent'
  if (file.availability === 'mode-only') {
    return beforeMode === afterMode
      ? `File mode: ${beforeMode}.`
      : `File mode changed: ${beforeMode} → ${afterMode}.`
  }
  if (file.availability === 'binary') return `Binary file — no text content (mode ${afterMode}).`
  if (file.availability === 'too-large') return 'Text content exceeds the retained read limit.'
  return `Content ${file.availability}.`
}

export interface RehearsalReviewContentProps {
  identity: RehearsalReviewIdentity
  reviewRevision: string
  scopeId: string
  entry: RehearsalReviewEntry | null
  file: RehearsalReviewFileResult | null
  view: RehearsalReviewFileView
  afterAvailable: boolean
  loading: boolean
  onSelectView: (view: RehearsalReviewFileView) => void
}

/** Controlled content/view seam; retrieval remains revision-bound in R2. */
export function RehearsalReviewContent({
  entry,
  file,
  view,
  afterAvailable,
  onSelectView
}: RehearsalReviewContentProps): React.JSX.Element {
  return (
    <div className="rehearsal-review-content" aria-live="polite">
      {entry && (
        <>
          <h4>{name(entry)}</h4>
          <div role="tablist" aria-label="Frozen file view">
            {(['changes', 'before', 'after'] as const).map((candidate) => (
              <button
                role="tab"
                aria-selected={view === candidate}
                disabled={candidate === 'after' && !afterAvailable}
                key={candidate}
                onClick={() => onSelectView(candidate)}
              >
                {candidate[0].toUpperCase() + candidate.slice(1)}
              </button>
            ))}
          </div>
          {file && file.availability !== 'available' && file.availability !== 'absent' && (
            <p role="status">{contentStatus(file)}</p>
          )}
          {file?.availability === 'absent' && <p className="empty">This side is absent.</p>}
          {file?.text !== null && file?.text !== undefined && <pre>{file.text}</pre>}
          {view === 'changes' && file?.availability === 'available' && <Hunks file={file} />}
        </>
      )}
      {!entry && <p className="empty">Select a changed file to inspect its retained content.</p>}
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
  const [filePageCount, setFilePageCount] = useState(1)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [knownTotal, setKnownTotal] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null)
  const [inventoryPercent, setInventoryPercent] = useState(() => {
    if (typeof window === 'undefined') return 34
    const stored = Number(window.localStorage.getItem('git-city.review.inventory-percent'))
    return Number.isFinite(stored) ? Math.max(24, Math.min(48, stored)) : 34
  })
  const [cityVisible, setCityVisible] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.localStorage.getItem('git-city.review.city-visible') === 'true'
  )
  const previousRevision = useRef<string | null>(null)
  const previousIdentity = useRef<string | null>(null)
  const previousReport = useRef<RehearsalReport | null>(null)
  const previousReportKey = useRef<string | null>(null)
  const resizeStart = useRef<{ x: number; percent: number } | null>(null)

  useEffect(() => {
    window.localStorage.setItem('git-city.review.inventory-percent', String(inventoryPercent))
  }, [inventoryPercent])
  useEffect(() => {
    window.localStorage.setItem('git-city.review.city-visible', String(cityVisible))
  }, [cityVisible])
  const api = bridge()
  const clearRehearsalComparison = useStore((s) => s.clearRehearsalComparison)
  const rehearsalComparison = useStore((s) => s.rehearsalComparison)
  const { id, repository, repository_id, origin_worktree } = report
  const reviewIdentity = useMemo(
    () => ({ id, repository, repository_id, origin_worktree }),
    [id, repository, repository_id, origin_worktree]
  )
  const identityKey = useMemo(
    () => JSON.stringify([id, repository, repository_id, origin_worktree]),
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
    async (client, [request]) => {
      const result = await client.rehearsalReviewSummary(request)
      return validateRehearsalReviewSummaryResponse(result, request)
    }
  )
  const reloadSummary = summaryQuery.reload
  useEffect(() => {
    // The report object can be replaced after Refresh without any public
    // report fields changing. That is still a new read boundary: the retained
    // object may have been deleted or become unavailable in the meantime.
    if (previousReport.current && previousReport.current !== report) {
      setRefreshNonce((nonce) => nonce + 1)
      if (previousReportKey.current === key) reloadSummary()
    }
    previousReport.current = report
    previousReportKey.current = key
  }, [key, reloadSummary, report])
  const summary = summaryQuery.loading ? null : summaryQuery.data
  const scopeId = selectedScopeId ?? summary?.defaultScopeId ?? null
  const filesQuery = useRepoQuery(
    summary && scopeId
      ? ([
          reviewIdentity,
          summary.reviewRevision,
          scopeId,
          filePageCount,
          appliedFilter,
          refreshNonce
        ] as const)
      : null,
    async (client, [request, revision, scope, pages, filterValue]) => {
      let cursor: string | undefined
      let result = null as Awaited<ReturnType<typeof client.rehearsalReviewFiles>> | null
      const entries: RehearsalReviewEntry[] = []
      for (let page = 0; page < pages; page++) {
        const response = await client.rehearsalReviewFiles(
          request,
          revision,
          scope,
          cursor,
          filterValue
        )
        result = validateRehearsalReviewFilesResponse(response, request, revision, scope)
        entries.push(...result.entries)
        if (!result.nextCursor) break
        cursor = result.nextCursor
      }
      // The final page's metadata describes the aggregate request. Keeping
      // its cursor lets the user request one more page without exposing any
      // partially refreshed page to the renderer.
      return result
        ? { ...result, entries, nextCursor: result.nextCursor }
        : {
            identity: request,
            reviewRevision: revision,
            scopeId: scope,
            entries,
            nextCursor: null,
            total: null,
            complete: false,
            filter: filterValue || null
          }
    }
  )
  const files = filesQuery.loading ? null : filesQuery.data
  const fileEntries = useMemo(() => files?.entries ?? [], [files])
  const nextCursor = files?.nextCursor ?? null
  const selected = fileEntries.find((entry) => entry.entryId === selectedEntryId) ?? null
  const fileQuery = useRepoQuery(
    summary && scopeId && selected
      ? ([
          reviewIdentity,
          summary.reviewRevision,
          scopeId,
          selected.entryId,
          view,
          refreshNonce
        ] as const)
      : null,
    async (client, [request, revision, scope, entryId, selectedView]) => {
      const result = await client.rehearsalReviewFile(
        request,
        revision,
        scope,
        entryId,
        selectedView
      )
      return validateRehearsalReviewFileResponse(
        result,
        request,
        revision,
        scope,
        entryId,
        selectedView
      )
    }
  )
  const file = fileQuery.loading ? null : fileQuery.data
  const loading = summaryQuery.loading || filesQuery.loading || fileQuery.loading
  const error = summaryQuery.error || filesQuery.error || fileQuery.error
  const reviewPaths = useMemo(
    () => [...new Set(fileEntries.flatMap(reviewEntryPaths))],
    [fileEntries]
  )
  const reviewMarkers = useMemo(() => reviewEntryMarkers(fileEntries), [fileEntries])
  const selectedScope = summary?.scopes.find((candidate) => candidate.scopeId === scopeId) ?? null
  const selectedAfterAvailable = Boolean(
    selectedScope?.available &&
    selectedScope.after &&
    (selectedScope.kind === 'committed-reference' || summary?.afterAvailable)
  )
  // The legacy city comparison bridge resolves the retained worktree endpoints
  // only. Never display that result while a committed-reference scope is
  // selected; its frozen text endpoints remain the authoritative review.
  const cityScopeSupported = selectedScope?.kind === 'tracked-worktree'
  useEffect(() => {
    if (!cityScopeSupported && rehearsalComparison) clearRehearsalComparison()
  }, [cityScopeSupported, rehearsalComparison, clearRehearsalComparison])

  // Replacing a report revision invalidates the inventory and pending content,
  // while a harmless refresh keeps a surviving selection by entry ID.
  useEffect(() => {
    if (previousIdentity.current && previousIdentity.current !== identityKey) {
      setSelectedEntryId(null)
      setSelectedScopeId(null)
      setView('changes')
      setFilter('')
      setAppliedFilter('')
      setFilePageCount(1)
      setKnownTotal(null)
      previousRevision.current = null
      clearRehearsalComparison()
    }
    previousIdentity.current = identityKey
  }, [clearRehearsalComparison, identityKey])

  useEffect(() => {
    if (summary && !summary.scopes.some((scope) => scope.scopeId === selectedScopeId))
      setSelectedScopeId(summary.defaultScopeId ?? summary.scopes[0]?.scopeId ?? null)
  }, [summary, selectedScopeId])

  useEffect(() => {
    const revision = summary?.reviewRevision
    if (!revision) return
    if (previousRevision.current && previousRevision.current !== revision) {
      setSelectedEntryId(null)
      setView('changes')
      setFilePageCount(1)
      setKnownTotal(null)
    }
    previousRevision.current = revision
  }, [summary?.reviewRevision])

  useEffect(() => {
    setFilePageCount(1)
    setKnownTotal(null)
  }, [scopeId, appliedFilter])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const start = resizeStart.current
      if (!start) return
      const delta = ((event.clientX - start.x) / window.innerWidth) * 100
      setInventoryPercent(Math.max(24, Math.min(48, start.percent + delta)))
    }
    const stop = (): void => {
      resizeStart.current = null
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [])

  useEffect(() => {
    if (!files || filesQuery.loading) return
    setKnownTotal(files.total)
    setSelectedEntryId((current) => {
      if (current && files.entries.some((entry) => entry.entryId === current)) return current
      return files.entries[0]?.entryId ?? null
    })
  }, [files, filesQuery.loading])

  const loadFiles = (nextFilter: string): void => {
    setSelectedEntryId(null)
    setAppliedFilter(nextFilter)
    setFilePageCount(1)
  }

  const loadMore = (): void => {
    if (nextCursor) setFilePageCount((count) => count + 1)
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    resizeStart.current = { x: event.clientX, percent: inventoryPercent }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setInventoryPercent((value) =>
        Math.max(24, Math.min(48, value + (event.key === 'ArrowLeft' ? -2 : 2)))
      )
    }
  }

  const choose = (entry: RehearsalReviewEntry): void => {
    setSelectedEntryId(entry.entryId)
    setView('changes')
  }

  const selectView = (nextView: RehearsalReviewFileView): void => {
    setView(nextView)
  }

  const toggleCity = (): void => {
    if (cityVisible) clearRehearsalComparison()
    setCityVisible((visible) => !visible)
  }

  return (
    <section
      className="rehearsal-review-panel rehearsal-review-workspace"
      aria-label="Frozen rehearsal review"
    >
      <div className="rehearsal-review-heading">
        <div>
          <p className="rehearsal-review-eyebrow">Review workspace</p>
          <h3>Frozen file review</h3>
        </div>
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
              {summary.notices.length > 0 && (
                <details className="rehearsal-review-notices">
                  <summary>Review scope and limits ({summary.notices.length})</summary>
                  <ul>
                    {summary.notices.map((notice, index) => (
                      <li key={`${notice}:${index}`}>{notice}</li>
                    ))}
                  </ul>
                </details>
              )}
              {selectedScope && !selectedScope.available && (
                <p role="alert">
                  ⚠ {selectedScope.unavailableReason ?? 'This scope is unavailable.'}
                </p>
              )}
              {!selectedAfterAvailable && selectedScope?.available && (
                <p role="alert">
                  ⚠{' '}
                  {selectedScope.unavailableReason ??
                    summary.afterReason ??
                    'After endpoint unavailable.'}
                </p>
              )}
              <div className="rehearsal-review-toolbar">
                <RehearsalReviewScopeSelector
                  scopes={summary.scopes}
                  selectedScopeId={scopeId}
                  disabled={loading}
                  onSelectScope={(nextScope) => {
                    setSelectedScopeId(nextScope)
                    setSelectedEntryId(null)
                    setFilePageCount(1)
                    clearRehearsalComparison()
                  }}
                />
                <button type="button" aria-pressed={cityVisible} onClick={toggleCity}>
                  {cityVisible ? 'Hide city context' : 'Show city context'}
                </button>
                <span role="status" aria-live="polite">
                  {selected ? `Selected ${name(selected)}` : 'Select a changed file'}
                </span>
              </div>
              {cityVisible && (
                <div className="rehearsal-review-city-slot" aria-label="Optional rehearsal city">
                  {cityScopeSupported ? (
                    <RehearsalCityComparison
                      report={report}
                      reviewPaths={reviewPaths}
                      reviewMarkers={reviewMarkers}
                      selectedEntry={selected}
                      onSelectPath={(path) => {
                        const entry = fileEntries.find(
                          (candidate) => candidate.oldPath === path || candidate.newPath === path
                        )
                        if (entry) choose(entry)
                      }}
                    />
                  ) : (
                    <p className="rehearsal-review-city-note" role="status">
                      City context is unavailable for a committed-reference scope; its frozen text
                      endpoints remain available below.
                    </p>
                  )}
                </div>
              )}
              <div
                className="rehearsal-review-layout"
                style={
                  { '--rehearsal-inventory-width': `${inventoryPercent}%` } as React.CSSProperties
                }
              >
                <RehearsalReviewFileInventory
                  identity={reviewIdentity}
                  reviewRevision={summary.reviewRevision}
                  scopeId={scopeId ?? ''}
                  entries={fileEntries}
                  selectedEntryId={selectedEntryId}
                  total={authoritativeRehearsalReviewTotal(files, knownTotal)}
                  nextCursor={nextCursor}
                  filter={filter}
                  loading={loading}
                  onFilterChange={setFilter}
                  onApplyFilter={() => loadFiles(filter)}
                  onSelectEntry={(entryId) => {
                    const entry = fileEntries.find((candidate) => candidate.entryId === entryId)
                    if (entry) choose(entry)
                  }}
                  onLoadMore={loadMore}
                />
                <div
                  className="rehearsal-review-resizer"
                  role="separator"
                  aria-label="Resize file list"
                  aria-orientation="vertical"
                  aria-valuemin={24}
                  aria-valuemax={48}
                  aria-valuenow={Math.round(inventoryPercent)}
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={resizeByKeyboard}
                />
                <RehearsalReviewContent
                  identity={reviewIdentity}
                  reviewRevision={summary.reviewRevision}
                  scopeId={scopeId ?? ''}
                  entry={selected}
                  file={file}
                  view={view}
                  afterAvailable={selectedAfterAvailable}
                  loading={loading}
                  onSelectView={selectView}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
