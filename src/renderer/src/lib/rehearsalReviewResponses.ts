import type {
  RehearsalReviewFileResult,
  RehearsalReviewFilesResult,
  RehearsalReviewIdentity,
  RehearsalReviewSummary
} from '../../../shared/types'

function sameIdentity(left: RehearsalReviewIdentity, right: RehearsalReviewIdentity): boolean {
  return (
    left.id === right.id &&
    left.repository === right.repository &&
    left.origin_worktree === right.origin_worktree &&
    left.repository_id === right.repository_id
  )
}

export function validateRehearsalReviewSummaryResponse(
  response: RehearsalReviewSummary,
  identity: RehearsalReviewIdentity
): RehearsalReviewSummary {
  if (!sameIdentity(response.identity, identity))
    throw new Error('Frozen review response belongs to another rehearsal.')
  return response
}

export function validateRehearsalReviewFilesResponse(
  response: RehearsalReviewFilesResult,
  identity: RehearsalReviewIdentity,
  reviewRevision: string,
  scopeId: string
): RehearsalReviewFilesResult {
  if (
    !sameIdentity(response.identity, identity) ||
    response.reviewRevision !== reviewRevision ||
    response.scopeId !== scopeId
  )
    throw new Error('Frozen review file list response is stale.')
  return response
}

export function validateRehearsalReviewFileResponse(
  response: RehearsalReviewFileResult,
  identity: RehearsalReviewIdentity,
  reviewRevision: string,
  scopeId: string,
  entryId: string,
  view: RehearsalReviewFileResult['view']
): RehearsalReviewFileResult {
  if (
    !sameIdentity(response.identity, identity) ||
    response.reviewRevision !== reviewRevision ||
    response.scopeId !== scopeId ||
    response.entryId !== entryId ||
    response.view !== view
  )
    throw new Error('Frozen review content response is stale.')
  return response
}
