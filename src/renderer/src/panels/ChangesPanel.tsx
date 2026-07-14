import { useMemo, useState } from 'react'
import type { FileStatus, WorkingStatus } from '../../../shared/types'
import { isLiveState, useStore } from '../store'

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
        <button className="close" onClick={() => setPanel('none')}>
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
            <Row key={f.path} file={f} which="staged" onUnstage={() => void unstage([f.path])} />
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

function Row({
  file,
  which,
  onStage,
  onUnstage,
  onDiscard
}: {
  file: FileStatus
  which: 'staged' | 'unstaged' | 'conflict'
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
}): React.JSX.Element {
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)
  const code = which === 'staged' ? file.index : which === 'conflict' ? 'conflicted' : file.worktree
  const c = chip(code)
  return (
    <div
      className="file-row"
      onMouseEnter={() => setHovered(file.path)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => setSelected(file.path)}
    >
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
  )
}
