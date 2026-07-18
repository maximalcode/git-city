import { useEffect, useMemo, useState } from 'react'
import type { FileStatus, HunkInfo, WorkingStatus } from '../../../shared/types'
import { cleanError, hasApi, isLiveState, useStore } from '../store'

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  modified: { label: 'M', cls: 'chip-mod' },
  added: { label: 'A', cls: 'chip-add' },
  deleted: { label: 'D', cls: 'chip-del' },
  renamed: { label: 'R', cls: 'chip-add' },
  typechange: { label: 'T', cls: 'chip-mod' },
  untracked: { label: 'U', cls: 'chip-new' },
  conflicted: { label: '!', cls: 'chip-conflict' }
}

function chip(code: string): { label: string; cls: string } {
  return STATUS_CHIP[code] ?? { label: '?', cls: 'chip-mod' }
}

/** A file is "staged" if its index side changed and it isn't a plain untracked/conflict. */
function partition(status: WorkingStatus): {
  conflicted: FileStatus[]
  staged: FileStatus[]
  unstaged: FileStatus[]
} {
  const conflicted: FileStatus[] = []
  const staged: FileStatus[] = []
  const unstaged: FileStatus[] = []
  for (const f of status.files) {
    if (f.conflicted) conflicted.push(f)
    else {
      if (f.index !== 'unmodified') staged.push(f)
      if (f.worktree !== 'unmodified') unstaged.push(f)
    }
  }
  return { conflicted, staged, unstaged }
}

export default function ChangesPanel(): React.JSX.Element | null {
  const panel = useStore((s) => s.panel)
  const status = useStore((s) => s.workingStatus)
  const live = useStore(isLiveState)
  const opInProgress = useStore((s) => s.opInProgress)
  const stage = useStore((s) => s.stage)
  const unstage = useStore((s) => s.unstage)
  const discardAction = useStore((s) => s.discard)
  const commitAction = useStore((s) => s.commit)
  const askConfirm = useStore((s) => s.askConfirm)
  const openMergeView = useStore((s) => s.openMergeView)
  const jumpToNow = useStore((s) => s.jumpToNow)
  const setPanel = useStore((s) => s.setPanel)

  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  // which file rows are expanded to show per-hunk staging; keyed by "which:path"
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const parts = useMemo(() => (status ? partition(status) : null), [status])

  if (panel !== 'changes') return null

  const busy = opInProgress !== null
  const stagedCount = parts?.staged.length ?? 0
  const canCommit = !busy && message.trim().length > 0 && (stagedCount > 0 || amend)

  const doDiscard = (path: string): void =>
    askConfirm({
      title: 'Discard changes?',
      body: `Throw away your uncommitted changes to "${path}"? This cannot be undone.`,
      confirmLabel: 'Discard',
      danger: true,
      onConfirm: () => void discardAction([path])
    })

  const toggleAmend = (): void => {
    const next = !amend
    setAmend(next)
    if (next && !message.trim() && status) {
      const repo = useStore.getState().repoPath
      if (repo && 'gitCity' in window) {
        void window.gitCity.lastCommitMessage(repo).then((m) => {
          if (m) setMessage(m)
        })
      }
    }
  }

  const doCommit = (): void => {
    const pushed = status && status.upstream && status.ahead === 0
    if (amend && pushed) {
      askConfirm({
        title: 'Amend a pushed commit?',
        body: 'This commit was already pushed. Amending rewrites it, so you will not be able to push the change without a force-push (which Git City does not do). Continue?',
        confirmLabel: 'Amend anyway',
        danger: true,
        onConfirm: () => {
          void commitAction(message, amend)
          setMessage('')
          setAmend(false)
        }
      })
      return
    }
    void commitAction(message, amend)
    setMessage('')
    setAmend(false)
  }

  return (
    <div className="side-panel changes-panel">
      <div className="panel-head">
        <span>Changes</span>
        <button className="close" aria-label="Close" onClick={() => setPanel('none')}>
          ✕
        </button>
      </div>

      {!live && (
        <div className="panel-banner">
          Viewing history — changes apply to the working tree.
          <button onClick={jumpToNow}>Jump to now</button>
        </div>
      )}

      <div className="panel-scroll">
        {parts && parts.conflicted.length > 0 && (
          <section>
            <div className="section-head danger-text">
              <span>Conflicts</span>
              <button className="danger" onClick={openMergeView}>
                Resolve
              </button>
            </div>
            {parts.conflicted.map((f) => (
              <Row key={f.path} file={f} which="conflict" />
            ))}
          </section>
        )}

        <section>
          <div className="section-head">
            <span>Staged ({stagedCount})</span>
            {stagedCount > 0 && (
              <button
                disabled={busy}
                onClick={() => void unstage(parts!.staged.map((f) => f.path))}
              >
                Unstage all
              </button>
            )}
          </div>
          {parts?.staged.map((f) => (
            <Row
              key={f.path}
              file={f}
              which="staged"
              onUnstage={() => void unstage([f.path])}
              expanded={expanded.has(`staged:${f.path}`)}
              onToggleExpand={() => toggleExpand(`staged:${f.path}`)}
            />
          ))}
          {stagedCount === 0 && <div className="empty">Nothing staged</div>}
        </section>

        <section>
          <div className="section-head">
            <span>Changes ({parts?.unstaged.length ?? 0})</span>
            {parts && parts.unstaged.length > 0 && (
              <button disabled={busy} onClick={() => void stage(parts.unstaged.map((f) => f.path))}>
                Stage all
              </button>
            )}
          </div>
          {parts?.unstaged.map((f) => (
            <Row
              key={f.path}
              file={f}
              which="unstaged"
              onStage={() => void stage([f.path])}
              onDiscard={() => doDiscard(f.path)}
              expanded={expanded.has(`unstaged:${f.path}`)}
              onToggleExpand={() => toggleExpand(`unstaged:${f.path}`)}
            />
          ))}
          {parts && parts.unstaged.length === 0 && <div className="empty">No local changes</div>}
        </section>
      </div>

      <div className="commit-box">
        <textarea
          placeholder="Commit message"
          value={message}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
        />
        <label className="amend-row">
          <input type="checkbox" checked={amend} onChange={toggleAmend} disabled={busy} />
          Amend previous commit
        </label>
        <button className="primary commit-btn" disabled={!canCommit} onClick={doCommit}>
          {amend ? 'Amend' : 'Commit'}
          {stagedCount > 0 ? ` ${stagedCount} file${stagedCount === 1 ? '' : 's'}` : ''}
        </button>
      </div>
    </div>
  )
}

/** A tracked, non-conflict text change can be expanded to stage by hunk. */
function canExpand(file: FileStatus, which: 'staged' | 'unstaged' | 'conflict'): boolean {
  if (which === 'conflict') return false
  if (which === 'staged') return true // index side has staged hunks (incl. new files)
  return (
    file.worktree === 'modified' || file.worktree === 'typechange' || file.worktree === 'deleted'
  )
}

function Row({
  file,
  which,
  onStage,
  onUnstage,
  onDiscard,
  expanded,
  onToggleExpand
}: {
  file: FileStatus
  which: 'staged' | 'unstaged' | 'conflict'
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
  expanded?: boolean
  onToggleExpand?: () => void
}): React.JSX.Element {
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)
  const code = which === 'staged' ? file.index : which === 'conflict' ? 'conflicted' : file.worktree
  const c = chip(code)
  const expandable = canExpand(file, which) && !!onToggleExpand
  return (
    <>
      <div
        className="file-row"
        onMouseEnter={() => setHovered(file.path)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => setSelected(file.path)}
      >
        <button
          className={`row-expand ${expanded ? 'open' : ''}`}
          title={expandable ? 'Stage by hunk' : ''}
          disabled={!expandable}
          aria-label="Toggle hunks"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand?.()
          }}
        >
          {expandable ? '▸' : ''}
        </button>
        <span className={`status-chip ${c.cls}`}>{c.label}</span>
        <span className="file-path" title={file.path}>
          {file.path}
        </span>
        <span className="row-actions">
          {onStage && (
            <button
              title="Stage"
              onClick={(e) => {
                e.stopPropagation()
                onStage()
              }}
            >
              +
            </button>
          )}
          {onUnstage && (
            <button
              title="Unstage"
              onClick={(e) => {
                e.stopPropagation()
                onUnstage()
              }}
            >
              −
            </button>
          )}
          {onDiscard && (
            <button
              title="Discard"
              className="danger"
              onClick={(e) => {
                e.stopPropagation()
                onDiscard()
              }}
            >
              ↺
            </button>
          )}
        </span>
      </div>
      {expanded && expandable && <HunkList path={file.path} staged={which === 'staged'} />}
    </>
  )
}

/** Per-hunk staging for one file. Refetches whenever the working status changes
 *  (i.e. after any hunk op completes via runOp → refreshStatus). */
function HunkList({ path, staged }: { path: string; staged: boolean }): React.JSX.Element {
  const status = useStore((s) => s.workingStatus) // refetch trigger
  const busy = useStore((s) => s.opInProgress !== null)
  const applyHunk = useStore((s) => s.applyHunk)
  const askConfirm = useStore((s) => s.askConfirm)

  const [hunks, setHunks] = useState<HunkInfo[] | null>(null)
  const [binary, setBinary] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const repo = useStore.getState().repoPath
    if (!hasApi() || !repo) return
    let cancelled = false
    setError(null)
    void window.gitCity
      .fileHunks(repo, path, staged)
      .then((r) => {
        if (cancelled) return
        setHunks(r.hunks)
        setBinary(r.binary)
      })
      .catch((err) => !cancelled && setError(cleanError(err)))
    return () => {
      cancelled = true
    }
  }, [path, staged, status])

  if (error) return <div className="hunk-note">{error}</div>
  if (binary) return <div className="hunk-note">Binary file — stage the whole file.</div>
  if (!hunks) return <div className="hunk-note">Loading hunks…</div>
  if (hunks.length === 0) return <div className="hunk-note">No hunks.</div>

  const discardHunk = (header: string): void =>
    askConfirm({
      title: 'Discard this hunk?',
      body: `Throw away this one change to "${path}"? This cannot be undone.`,
      confirmLabel: 'Discard',
      danger: true,
      onConfirm: () => void applyHunk(path, header, 'discard')
    })

  return (
    <div className="hunk-list">
      {hunks.map((h) => (
        <div key={h.header} className="hunk-block">
          <div className="hunk-bar">
            <span className="hunk-counts">
              <span className="diff-add">+{h.additions}</span>{' '}
              <span className="diff-del">−{h.deletions}</span>
            </span>
            <span className="hunk-header" title={h.header}>
              {h.header}
            </span>
            <span className="hunk-btns">
              {staged ? (
                <button disabled={busy} onClick={() => void applyHunk(path, h.header, 'unstage')}>
                  − Unstage
                </button>
              ) : (
                <>
                  <button disabled={busy} onClick={() => void applyHunk(path, h.header, 'stage')}>
                    + Stage
                  </button>
                  <button
                    disabled={busy}
                    className="danger"
                    title="Discard hunk"
                    onClick={() => discardHunk(h.header)}
                  >
                    ↺
                  </button>
                </>
              )}
            </span>
          </div>
          <div className="hunk-lines">
            {h.lines.map((l, i) => (
              <div key={i} className={`diff-line diff-${l.kind}`}>
                <span className="diff-gutter">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                </span>
                <span className="diff-text">{l.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
