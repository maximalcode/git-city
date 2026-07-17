/** Shared display formatting — keep dates and sync badges consistent everywhere. */

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString()
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

/** The `↑n ↓n` ahead/behind badge used in the HUD and the branches panel. */
export function AheadBehind({
  ahead,
  behind
}: {
  ahead: number
  behind: number
}): React.JSX.Element | null {
  if (ahead <= 0 && behind <= 0) return null
  return (
    <span className="ab-badge">
      {ahead > 0 && `↑${ahead}`} {behind > 0 && `↓${behind}`}
    </span>
  )
}
