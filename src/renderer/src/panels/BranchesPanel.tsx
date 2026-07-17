import { useState } from 'react'
import type { BranchInfo } from '../../../shared/types'
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

  const [newName, setNewName] = useState('')
  const [newTag, setNewTag] = useState('')

  if (panel !== 'branches') return null

  const current = branches.find((b) => b.current)
  const localBranches = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)
  const dirty = (status?.files.length ?? 0) > 0

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
      onConfirm: async () => {
        await stashPush(`switch to ${name}`, true)
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
        const before = useStore.getState().opError
        await deleteBranch(b.name, false)
        const err = useStore.getState().opError
        // git refused because it isn't merged → offer force delete
        if (err && err !== before && /not fully merged/i.test(err.message)) {
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
        <button className="close" onClick={() => setPanel('none')}>
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
              {(b.ahead > 0 || b.behind > 0) && (
                <span className="ab-badge">
                  {b.ahead > 0 && `↑${b.ahead}`} {b.behind > 0 && `↓${b.behind}`}
                </span>
              )}
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
      </div>
    </div>
  )
}
