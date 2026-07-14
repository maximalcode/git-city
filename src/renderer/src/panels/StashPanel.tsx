import { useState } from 'react'
import { useStore } from '../store'

export default function StashPanel(): React.JSX.Element | null {
  const panel = useStore((s) => s.panel)
  const stashes = useStore((s) => s.stashes)
  const status = useStore((s) => s.workingStatus)
  const busy = useStore((s) => s.opInProgress !== null)
  const setPanel = useStore((s) => s.setPanel)
  const stashPush = useStore((s) => s.stashPush)
  const stashPop = useStore((s) => s.stashPop)
  const stashApply = useStore((s) => s.stashApply)
  const stashDrop = useStore((s) => s.stashDrop)
  const askConfirm = useStore((s) => s.askConfirm)

  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(true)

  if (panel !== 'stashes') return null

  const hasChanges = (status?.files.length ?? 0) > 0

  const doPush = (): void => {
    void stashPush(message, untracked)
    setMessage('')
  }

  const doDrop = (index: number): void =>
    askConfirm({
      title: 'Drop stash?',
      body: 'This permanently removes the stashed changes.',
      confirmLabel: 'Drop',
      danger: true,
      onConfirm: () => void stashDrop(index)
    })

  return (
    <div className="side-panel stash-panel">
      <div className="panel-head">
        <span>Stashes</span>
        <button className="close" onClick={() => setPanel('none')}>
          ✕
        </button>
      </div>

      <div className="new-stash">
        <input
          type="text"
          placeholder="Stash message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hasChanges && doPush()}
        />
        <label className="amend-row">
          <input
            type="checkbox"
            checked={untracked}
            onChange={(e) => setUntracked(e.target.checked)}
          />
          Include untracked
        </label>
        <button disabled={busy || !hasChanges} onClick={doPush}>
          Stash changes
        </button>
      </div>

      <div className="panel-scroll">
        {stashes.length === 0 && <div className="empty">No stashes</div>}
        {stashes.map((s) => (
          <div key={s.index} className="stash-row">
            <div className="stash-msg" title={s.message}>
              {s.message}
            </div>
            <div className="stash-date">{new Date(s.date).toLocaleString()}</div>
            <div className="branch-actions">
              <button disabled={busy} onClick={() => void stashPop(s.index)}>
                Pop
              </button>
              <button disabled={busy} onClick={() => void stashApply(s.index)}>
                Apply
              </button>
              <button className="danger" disabled={busy} onClick={() => doDrop(s.index)}>
                Drop
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
