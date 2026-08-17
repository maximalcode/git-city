import { useState } from 'react'
import type { BranchInfo } from '../../../shared/types'
import { AheadBehind } from '../lib/format'
import { useStore } from '../store'

export default function BranchesPanel(): React.JSX.Element | null {
  const panel = useStore((s) => s.panel)
  const branches = useStore((s) => s.branches)
  const tags = useStore((s) => s.tags)
  const status = useStore((s) => s.workingStatus)
  const busy = useStore((s) => s.opInProgress !== null)
  const setPanel = useStore((s) => s.setPanel)
  const switchBranch = useStore((s) => s.switchBranch)
  const createBranch = useStore((s) => s.createBranch)
  const deleteBranch = useStore((s) => s.deleteBranch)
  const merge = useStore((s) => s.merge)
  const rebaseOnto = useStore((s) => s.rebaseOnto)
  const stashPush = useStore((s) => s.stashPush)
  const askConfirm = useStore((s) => s.askConfirm)
  const createTag = useStore((s) => s.createTag)
  const deleteTag = useStore((s) => s.deleteTag)
  const setRebaseOpen = useStore((s) => s.setRebaseOpen)
  const submodules = useStore((s) => s.submodules)
  const worktrees = useStore((s) => s.worktrees)
  const repoPath = useStore((s) => s.repoPath)
  const updateSubmodules = useStore((s) => s.updateSubmodules)
  const removeWorktree = useStore((s) => s.removeWorktree)
  const openPath = useStore((s) => s.openPath)

  const [newName, setNewName] = useState('')
  const [newTag, setNewTag] = useState('')

  if (panel !== 'branches') return null

  const current = branches.find((b) => b.current)
  const localBranches = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)
  const dirty = (status?.files.length ?? 0) > 0
  // a repo always has ≥1 (main) worktree — only surface the section when linked ones exist
  const showWorktrees = worktrees.length > 1
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const baseName = (p: string): string => norm(p).split('/').pop() || p

  const tryRemoveWorktree = (path: string): void =>
    askConfirm({
      title: 'Remove this worktree?',
      body: `Detach the worktree at "${path}". Its files stay on disk; git stops tracking it as a linked worktree.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        const result = await removeWorktree(path, false)
        if (!result.ok) {
          useStore.getState().dismissError()
          askConfirm({
            title: 'Worktree is dirty or locked',
            body: 'Force-remove it anyway? Uncommitted changes in that worktree will be lost.',
            confirmLabel: 'Force remove',
            danger: true,
            onConfirm: () => void removeWorktree(path, true)
          })
        }
      }
    })

  const trySwitch = (name: string): void => {
    if (!dirty) {
      void switchBranch(name)
      return
    }
    askConfirm({
      title: 'You have uncommitted changes',
      body: `Stash your changes and switch to "${name}"? Your work is saved to a stash you can restore later.`,
      confirmLabel: 'Stash & switch',
      danger: false,
      // the dialog promises the work is saved to a stash; if the stash fails,
      // switching anyway would carry the changes onto the other branch (or
      // fail with a message about the switch, saying nothing about the stash)
      onConfirm: async () => {
        const stashed = await stashPush(`switch to ${name}`, true)
        if (!stashed.ok) return
        await switchBranch(name)
      }
    })
  }

  const tryDelete = (b: BranchInfo): void =>
    askConfirm({
      title: `Delete branch "${b.name}"?`,
      body: 'This removes the local branch.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        const result = await deleteBranch(b.name, false)
        // git refused because it isn't merged → offer force delete. The code is
        // what the main process already decided; this used to re-derive it by
        // running a regex over the message on this side of the bridge (#107).
        if (result.code === 'not-merged') {
          useStore.getState().dismissError()
          askConfirm({
            title: `"${b.name}" is not fully merged`,
            body: 'Deleting it may discard commits that exist only on this branch. Force delete?',
            confirmLabel: 'Force delete',
            danger: true,
            onConfirm: () => void deleteBranch(b.name, true)
          })
        }
      }
    })

  const create = (andSwitch: boolean): void => {
    const name = newName.trim()
    if (!name) return
    void createBranch(name, andSwitch)
    setNewName('')
  }

  return (
    <div className="side-panel branches-panel">
      <div className="panel-head">
        <span>Branches</span>
        <button className="close" aria-label="Close" onClick={() => setPanel('none')}>
          ✕
        </button>
      </div>

      <div className="new-branch">
        <input
          type="text"
          placeholder="New branch name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create(true)}
        />
        <button disabled={busy || !newName.trim()} onClick={() => create(true)}>
          Create
        </button>
      </div>

      <div className="panel-scroll">
        <div className="section-head">
          <span>Local ({localBranches.length})</span>
        </div>
        {localBranches.map((b) => (
          <div key={b.name} className={`branch-row ${b.current ? 'current' : ''}`}>
            <div className="branch-main">
              <span className="branch-dot" />
              <span className="branch-label">{b.name}</span>
              <AheadBehind ahead={b.ahead} behind={b.behind} />
            </div>
            {!b.current && (
              <div className="branch-actions">
                <button disabled={busy} onClick={() => trySwitch(b.name)}>
                  Switch
                </button>
                <button disabled={busy} onClick={() => void merge(b.name)}>
                  Merge
                </button>
                <button
                  disabled={busy}
                  title={`Rebase ${current?.name ?? 'current'} onto ${b.name}`}
                  onClick={() => void rebaseOnto(b.name)}
                >
                  Rebase
                </button>
                <button className="danger" disabled={busy} onClick={() => tryDelete(b)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {remoteBranches.length > 0 && (
          <div className="section-head">
            <span>Remote ({remoteBranches.length})</span>
          </div>
        )}
        {remoteBranches.map((b) => (
          <div key={b.name} className="branch-row remote">
            <div className="branch-main">
              <span className="branch-dot remote" />
              <span className="branch-label">{b.name}</span>
            </div>
            <div className="branch-actions">
              <button disabled={busy} onClick={() => trySwitch(b.name)}>
                Checkout
              </button>
              <button disabled={busy} onClick={() => void merge(b.name)}>
                Merge
              </button>
            </div>
          </div>
        ))}

        <div className="section-head">
          <span>Tags ({tags.length})</span>
          <button disabled={busy} onClick={() => setRebaseOpen(true)} title="Interactive rebase">
            ⤥ Rebase…
          </button>
        </div>
        <div className="new-branch">
          <input
            type="text"
            placeholder="New tag on HEAD"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTag.trim()) {
                void createTag(newTag.trim())
                setNewTag('')
              }
            }}
          />
          <button
            disabled={busy || !newTag.trim()}
            onClick={() => {
              void createTag(newTag.trim())
              setNewTag('')
            }}
          >
            Tag
          </button>
        </div>
        {tags.map((t) => (
          <div key={t.name} className="branch-row">
            <div className="branch-main">
              <span className="ref-chip ref-tag">🏷 {t.name}</span>
              <span className="branch-label">{t.target}</span>
            </div>
            <div className="branch-actions">
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  askConfirm({
                    title: `Delete tag "${t.name}"?`,
                    body: 'This removes the local tag.',
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => void deleteTag(t.name)
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {submodules.length > 0 && (
          <>
            <div className="section-head">
              <span>Submodules ({submodules.length})</span>
              <button disabled={busy} onClick={() => void updateSubmodules()}>
                Update all
              </button>
            </div>
            {submodules.map((s) => (
              <div key={s.path} className="branch-row">
                <div className="branch-main">
                  <span className={`sub-state sub-${s.state}`} title={s.state} />
                  <span className="branch-label">{s.path}</span>
                  {s.describe && <span className="sub-describe">{s.describe}</span>}
                </div>
                <div className="branch-actions">
                  <button disabled={busy} onClick={() => void updateSubmodules(s.path)}>
                    Update
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {showWorktrees && (
          <>
            <div className="section-head">
              <span>Worktrees ({worktrees.length})</span>
            </div>
            {worktrees.map((w) => {
              const isCurrent = repoPath != null && norm(w.path) === norm(repoPath)
              return (
                <div key={w.path} className={`branch-row ${isCurrent ? 'current' : ''}`}>
                  <div className="branch-main">
                    <span className="branch-dot" />
                    <span className="branch-label" title={w.path}>
                      {baseName(w.path)}
                    </span>
                    <span className="wt-branch">
                      {w.branch ?? (w.detached ? 'detached' : w.bare ? 'bare' : '')}
                      {w.locked ? ' 🔒' : ''}
                    </span>
                  </div>
                  {!isCurrent && (
                    <div className="branch-actions">
                      <button disabled={busy} onClick={() => void openPath(w.path)}>
                        Open
                      </button>
                      <button
                        className="danger"
                        disabled={busy || w.bare}
                        onClick={() => tryRemoveWorktree(w.path)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
