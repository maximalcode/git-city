import type { ReflogEntry } from '../../../shared/types'
import { formatDate } from '../lib/format'
import { useRepoQuery } from '../lib/repoQuery'
import { useStore } from '../store'

const LOAD_COUNT = 80

/** A glyph per reflog action so the history scans at a glance. */
function actionGlyph(action: string): string {
  if (action.startsWith('commit')) return '●'
  if (action.startsWith('reset')) return '⟲'
  if (action.startsWith('checkout') || action.startsWith('branch')) return '⎇'
  if (action.startsWith('merge')) return '⑃'
  if (action.startsWith('rebase')) return '↻'
  if (action.startsWith('pull')) return '↓'
  if (action.startsWith('clone')) return '⎘'
  return '•'
}

/**
 * The time machine: HEAD's reflog as an undo/recover history. Every past HEAD
 * position is here (even ones a reset or bad rebase "lost"), so you can rewind
 * the current branch to any of them — or recover one as a new branch without
 * moving anything. All local-ref only; never force-pushes.
 */
export default function ReflogPanel(): React.JSX.Element | null {
  const reflogOpen = useStore((s) => s.reflogOpen)
  const repoPath = useStore((s) => s.repoPath)
  const headHash = useStore((s) => s.workingStatus?.headHash)
  const busy = useStore((s) => s.opInProgress !== null)
  const setReflogOpen = useStore((s) => s.setReflogOpen)
  const askConfirm = useStore((s) => s.askConfirm)
  const resetToReflog = useStore((s) => s.resetToReflog)
  const recoverBranch = useStore((s) => s.recoverBranch)

  // headHash is in the key, not an argument: the time machine's whole job is
  // moving HEAD, and it never refetched after doing so — the green "now" chip
  // stayed on the entry that was current before the rewind, the row just
  // rewound to still offered "⟲ Rewind", and the new reset entry that would
  // undo it never appeared. runOp refreshes status before resolving, so this is
  // current by then (#29).
  const {
    data: entries,
    loading,
    error,
    reload
  } = useRepoQuery(
    reflogOpen && repoPath ? ([repoPath, headHash ?? null] as const) : null,
    (api, [repo]) => api.reflog(repo, LOAD_COUNT)
  )

  if (!reflogOpen) return null

  const rows = entries ?? []

  const restore = (e: ReflogEntry): void =>
    askConfirm({
      title: 'Rewind to this point?',
      body: `Move the current branch to ${e.shortHash} "${e.subject || e.action}". Your uncommitted changes are kept (the rewind refuses rather than discard them). Commits after this point stay recoverable in the reflog.`,
      confirmLabel: 'Rewind',
      danger: true,
      onConfirm: () => void resetToReflog(e.hash, 'keep')
    })

  const recover = (e: ReflogEntry): void => {
    const name = `recovered/${e.shortHash}`
    askConfirm({
      title: 'Recover as a new branch?',
      body: `Create branch "${name}" at ${e.shortHash} "${e.subject || e.action}". Nothing else moves — your current branch is untouched.`,
      confirmLabel: 'Recover',
      danger: false,
      onConfirm: () => void recoverBranch(name, e.hash)
    })
  }

  return (
    <div className="reflog-panel">
      <div className="panel-head">
        <span>Time machine · HEAD history</span>
        <button className="close" aria-label="Close" onClick={() => setReflogOpen(false)}>
          ✕
        </button>
      </div>

      <div className="reflog-hint">
        Every past position of HEAD — rewind the branch here, or recover a lost point as a new
        branch. Nothing touches a remote.
      </div>

      <div className="panel-scroll">
        {loading && <div className="empty">Loading history…</div>}
        {!loading && error && (
          <div className="panel-error">
            <span>{error}</span>
            <button onClick={reload}>Retry</button>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="empty">No reflog history yet.</div>
        )}
        {!loading &&
          rows.map((e) => (
            <div key={e.selector} className={`reflog-row ${e.index === 0 ? 'current' : ''}`}>
              <span className="reflog-glyph" title={e.action}>
                {actionGlyph(e.action)}
              </span>
              <div className="reflog-main">
                <div className="reflog-line">
                  <span className="reflog-action">{e.action}</span>
                  <span className="reflog-hash">{e.shortHash}</span>
                  {e.index === 0 && <span className="reflog-now">now</span>}
                </div>
                <div className="reflog-subject" title={e.message || e.subject}>
                  {e.subject || e.message || '—'}
                </div>
                <div className="reflog-date">{formatDate(e.date)}</div>
              </div>
              <div className="reflog-actions">
                <button disabled={busy || e.index === 0} onClick={() => restore(e)} title="Rewind">
                  ⟲ Rewind
                </button>
                <button disabled={busy} onClick={() => recover(e)} title="Recover as branch">
                  ⑂ Recover
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
