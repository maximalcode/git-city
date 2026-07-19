import { useStore } from '../store'

/**
 * Unobtrusive "a newer version is available" banner. We don't auto-download or
 * silently replace the app (that would need electron-updater + code signing) —
 * we just point the user at the GitHub release so they stay in control. Shown
 * on any screen; dismissable for the session.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const update = useStore((s) => s.update)
  const dismiss = useStore((s) => s.dismissUpdate)
  const openExternal = useStore((s) => s.openExternal)

  if (!update) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-dot" />
      <span className="update-text">
        Git City <strong>{update.version}</strong> is available
      </span>
      <button className="update-view" onClick={() => openExternal(update.url)}>
        View release
      </button>
      <button className="update-dismiss" aria-label="Dismiss" onClick={dismiss}>
        ✕
      </button>
    </div>
  )
}
