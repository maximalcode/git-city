import type { RehearsalReviewScope } from '../../../shared/types'

/** Controlled scope presentation seam shared by the review and workspace views. */
export interface RehearsalReviewScopeSelectorProps {
  scopes: RehearsalReviewScope[]
  selectedScopeId: string | null
  disabled?: boolean
  onSelectScope: (scopeId: string) => void
}

export function RehearsalReviewScopeSelector({
  scopes,
  selectedScopeId,
  disabled = false,
  onSelectScope
}: RehearsalReviewScopeSelectorProps): React.JSX.Element {
  return (
    <select
      aria-label="Review scope"
      value={selectedScopeId ?? ''}
      disabled={disabled}
      onChange={(event) => onSelectScope(event.target.value)}
    >
      {scopes.map((scope) => (
        <option key={scope.scopeId} value={scope.scopeId} disabled={!scope.available}>
          {scope.label}
          {scope.replay ? ` · replay ${scope.replay.compared ? 'compared' : 'uncompared'}` : ''}
        </option>
      ))}
    </select>
  )
}
