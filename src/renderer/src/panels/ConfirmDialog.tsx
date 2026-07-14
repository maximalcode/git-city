import { useStore } from '../store'

/** App-root modal driven by store.confirm. Every destructive op routes through here. */
export default function ConfirmDialog(): React.JSX.Element | null {
  const confirm = useStore((s) => s.confirm)
  const resolve = useStore((s) => s.resolveConfirm)
  if (!confirm) return null

  return (
    <div className="modal-backdrop" onClick={() => resolve(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{confirm.title}</h3>
        <p>{confirm.body}</p>
        <div className="modal-actions">
          <button onClick={() => resolve(false)}>Cancel</button>
          <button className={confirm.danger ? 'danger' : 'primary'} onClick={() => resolve(true)}>
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
