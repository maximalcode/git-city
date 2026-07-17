import { useStore } from '../store'

/** Bottom-center toast for failed ops. Expands to show raw git output (the auth-error surface). */
export default function OpErrorToast(): React.JSX.Element | null {
  const opError = useStore((s) => s.opError)
  const dismiss = useStore((s) => s.dismissError)
  if (!opError) return null

  return (
    <div className="op-toast">
      <button className="close" aria-label="Close" onClick={dismiss}>
        ✕
      </button>
      <div className="op-toast-msg">{opError.message}</div>
      {opError.gitOutput && (
        <details>
          <summary>Details</summary>
          <pre>{opError.gitOutput}</pre>
        </details>
      )}
    </div>
  )
}
