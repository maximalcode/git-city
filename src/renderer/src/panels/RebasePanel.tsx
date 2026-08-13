import { useEffect, useState } from 'react'
import type { RebaseEntry } from '../../../shared/types'
import { useRepoQuery } from '../lib/repoQuery'
import { useStore } from '../store'

const LOAD_COUNT = 15

/**
 * Visual interactive-rebase editor. Loads the last N commits of the current
 * branch; the user reorders / picks / squashes / drops them, then applies.
 * Confirmation-gated; never force-pushes (it rewrites local history only).
 */
export default function RebasePanel(): React.JSX.Element | null {
  const rebaseOpen = useStore((s) => s.rebaseOpen)
  const repoPath = useStore((s) => s.repoPath)
  const busy = useStore((s) => s.opInProgress !== null)
  const setRebaseOpen = useStore((s) => s.setRebaseOpen)
  const askConfirm = useStore((s) => s.askConfirm)
  const runRebase = useStore((s) => s.runInteractiveRebase)

  const {
    data: todo,
    loading,
    error,
    reload
  } = useRepoQuery(rebaseOpen && repoPath ? ([repoPath] as const) : null, (api, [repo]) =>
    api.rebaseTodo(repo, LOAD_COUNT)
  )

  const base = todo?.base ?? null
  const hasMerges = todo?.hasMerges ?? false
  // the todo becomes the user's working copy the moment it lands — they reorder
  // and re-action it in place, so it is local state seeded from the read
  const [entries, setEntries] = useState<RebaseEntry[]>([])
  useEffect(() => setEntries(todo?.entries ?? []), [todo])

  if (!rebaseOpen) return null

  const move = (i: number, dir: -1 | 1): void =>
    setEntries((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const setAction = (i: number, action: RebaseEntry['action']): void =>
    setEntries((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], action }
      return next
    })

  const changed = entries.some((e) => e.action !== 'pick') // squash/drop present
  // reorder detection is implicit; applying a pure reorder is still a valid rebase

  const apply = (): void =>
    askConfirm({
      title: 'Rewrite history?',
      body: `This interactive rebase rewrites the last ${entries.length} commits of this branch. If they were already pushed you won't be able to push the result (Git City never force-pushes). Continue?`,
      confirmLabel: 'Rebase',
      danger: true,
      onConfirm: () => void runRebase(base, entries)
    })

  return (
    <div className="rebase-panel">
      <div className="panel-head">
        <span>Interactive rebase · last {entries.length} commits</span>
        <button className="close" aria-label="Close" onClick={() => setRebaseOpen(false)}>
          ✕
        </button>
      </div>

      {hasMerges && (
        <div className="panel-banner">
          Range contains merge commits — rebase may behave unexpectedly.
        </div>
      )}

      <div className="rebase-hint">
        Order is newest → oldest. Squash folds a commit into the one below it. Reword isn't
        supported yet.
      </div>

      <div className="panel-scroll">
        {loading && <div className="empty">Loading commits…</div>}
        {!loading && error && (
          <div className="panel-error">
            <span>{error}</span>
            <button onClick={reload}>Retry</button>
          </div>
        )}
        {!loading &&
          entries.map((e, i) => (
            <div key={e.hash} className={`rebase-row action-${e.action}`}>
              <div className="rebase-reorder">
                <button disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  ↑
                </button>
                <button
                  disabled={i === entries.length - 1}
                  onClick={() => move(i, 1)}
                  title="Move down"
                >
                  ↓
                </button>
              </div>
              <span className="rebase-hash">{e.shortHash}</span>
              <span className="rebase-subject">{e.subject}</span>
              <div className="rebase-actions">
                {(['pick', 'squash', 'drop'] as const).map((a) => (
                  <button
                    key={a}
                    className={e.action === a ? 'active' : ''}
                    onClick={() => setAction(i, a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>

      <div className="rebase-foot">
        <button onClick={() => setRebaseOpen(false)}>Cancel</button>
        <button
          className="danger"
          disabled={busy || loading || entries.length === 0}
          onClick={apply}
        >
          Rebase {entries.length} commits{changed ? '' : ' (reorder)'}
        </button>
      </div>
    </div>
  )
}
