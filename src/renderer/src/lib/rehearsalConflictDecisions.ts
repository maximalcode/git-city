import type { ConflictSegment, RehearsalDraftPayload } from '../../../shared/types'

/** A whole-file decision shares the durable acknowledgement field with hunk IDs. */
export const WHOLE_FILE_DECISION = 'whole-file'

export function rehearsalResolutionReadiness(
  segments: ConflictSegment[],
  draft: RehearsalDraftPayload,
  currentRevision: string
): { eligible: boolean; unreviewed: number[]; reason: string | null } {
  const acknowledgements = new Set(draft.acknowledged_hunks)
  const unreviewed = segments.flatMap((segment) =>
    segment.kind === 'conflict' &&
    (!acknowledgements.has(String(segment.id)) || !draft.choices[String(segment.id)])
      ? [segment.id]
      : []
  )
  if (draft.base_revision !== currentRevision)
    return {
      eligible: false,
      unreviewed,
      reason: 'Reconcile this draft with the changed sandbox first.'
    }
  if (draft.mode === 'whole-file' || !segments.some((segment) => segment.kind === 'conflict')) {
    const eligible = draft.whole_file_text !== null && acknowledgements.has(WHOLE_FILE_DECISION)
    return {
      eligible,
      unreviewed: [],
      reason: eligible ? null : 'Confirm the complete file resolution before saving.'
    }
  }
  return {
    eligible: unreviewed.length === 0,
    unreviewed,
    reason: unreviewed.length
      ? `${unreviewed.length} conflict section(s) still need a decision.`
      : null
  }
}
