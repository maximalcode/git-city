import { useEffect, useRef } from 'react'
import { useStore } from '../store'

/** App-root modal driven by store.confirm. Every destructive op routes through here. */
export default function ConfirmDialog(): React.JSX.Element | null {
  const confirm = useStore((s) => s.confirm)
  const resolve = useStore((s) => s.resolveConfirm)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Escape cancels, Enter confirms; focus starts on the confirm button so
  // Tab/Space work without reaching for the mouse.
  useEffect(() => {
    if (!confirm) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        resolve(false)
      } else if (e.key === 'Enter') {
        e.stopPropagation()
        resolve(true)
      }
    }
    // capture phase so the global hotkey handler never sees these keys
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, resolve])

  if (!confirm) return null

  return (
    <div className="modal-backdrop" onClick={() => resolve(false)}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={confirm.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{confirm.title}</h3>
        <p>{confirm.body}</p>
        <div className="modal-actions">
          <button onClick={() => resolve(false)}>Cancel</button>
          <button
            ref={confirmRef}
            className={confirm.danger ? 'danger' : 'primary'}
            onClick={() => resolve(true)}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
