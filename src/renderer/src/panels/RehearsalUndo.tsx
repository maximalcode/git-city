import { useCallback, useEffect, useRef, useState } from 'react'
import type { RehearsalUndoStatus } from '../../../shared/types'
import { bridge } from '../lib/bridge'
import { useStore } from '../store'

export default function RehearsalUndo({
  repo,
  blocked
}: {
  repo: string
  blocked: boolean
}): React.JSX.Element {
  const [status, setStatus] = useState<RehearsalUndoStatus | null>(null)
  const [confirmation, setConfirmation] = useState<RehearsalUndoStatus | null>(null)
  const [message, setMessage] = useState('')
  const busy = useStore((s) => s.rehearsalBusy)
  const undo = useStore((s) => s.undoRehearsal)
  const cancel = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const outcome = useRef<HTMLParagraphElement>(null)
  const mounted = useRef(true)
  const wasConfirming = useRef(false)
  const refresh = useCallback(async () => {
    try {
      const value = await bridge()?.rehearsalUndoStatus(repo)
      if (mounted.current) setStatus(value ?? null)
    } catch {
      if (mounted.current) {
        setStatus(null)
        setMessage('Could not inspect Undo availability. Refresh to try again.')
      }
    }
  }, [repo])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!busy) void refresh()
  }, [busy, blocked, refresh])
  useEffect(() => {
    const focused = (): void => {
      void refresh()
    }
    window.addEventListener('focus', focused)
    return () => window.removeEventListener('focus', focused)
  }, [refresh])
  useEffect(() => {
    if (confirmation) cancel.current?.focus()
    else if (wasConfirming.current) trigger.current?.focus()
    wasConfirming.current = !!confirmation
  }, [confirmation])
  useEffect(() => {
    if (message) outcome.current?.focus()
  }, [message])
  const dismiss = (): void => {
    setConfirmation(null)
  }
  return (
    <section
      aria-label="Undo Apply"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && confirmation) {
          event.preventDefault()
          event.stopPropagation()
          dismiss()
        }
      }}
    >
      <h3>Undo Apply</h3>
      {status?.rehearsal && (
        <p>
          Last Apply: <code>{status.rehearsal}</code>
          <br />
          Original worktree: {status.worktree}
        </p>
      )}
      <p>
        ⚠ Undo cannot overwrite local changes, including carried uncommitted work, changed refs or
        branches checked out elsewhere. No force option is available.
      </p>
      {!status?.available && <p role="status">{status?.reason ?? 'Checking Undo availability…'}</p>}
      {message && (
        <p ref={outcome} tabIndex={-1} role="status">
          {message}
        </p>
      )}
      <button disabled={busy} onClick={() => void refresh()}>
        Refresh Undo availability
      </button>{' '}
      {confirmation ? (
        <section aria-label="Confirm Undo Apply">
          <p>
            Undo Apply {confirmation.rehearsal} in {confirmation.worktree}? The backend will check
            the current state again.
          </p>
          <button ref={cancel} onClick={dismiss}>
            Cancel Undo
          </button>{' '}
          <button
            disabled={busy || blocked}
            onClick={async () => {
              setConfirmation(null)
              setMessage('')
              const result = await undo(confirmation)
              if (mounted.current && result) {
                setMessage(result.message)
                await refresh()
              }
            }}
          >
            Undo this Apply
          </button>
        </section>
      ) : (
        <button
          ref={trigger}
          disabled={busy || blocked || !status?.available}
          onClick={() => setConfirmation(status)}
        >
          Undo Apply
        </button>
      )}
    </section>
  )
}
