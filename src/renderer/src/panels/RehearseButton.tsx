import type { RehearsalAction } from '../../../shared/types'
import { useStore } from '../store'

/** Explicit development entry from an existing branch or single-commit selection. */
export function RehearseButton({
  action,
  target
}: {
  action: RehearsalAction
  target: string
}): React.JSX.Element | null {
  const configured = useStore((s) => s.rehearsalConfigured)
  const busy = useStore((s) => s.rehearsalBusy || s.opInProgress !== null)
  const open = useStore((s) => s.openRehearsal)
  if (!import.meta.env.DEV || !configured) return null
  return (
    <button
      disabled={busy}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation()
      }}
      onClick={() => open({ action, target })}
    >
      Rehearse {action}
    </button>
  )
}
