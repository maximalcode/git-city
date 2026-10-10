import type {
  RehearsalReviewChange,
  RehearsalReviewEntry,
  RehearsalReviewEntrySummary,
  Snapshot
} from '../../../shared/types'

export interface RehearsalReviewMarker {
  path: string
  change: RehearsalReviewChange
  label: string
}

/** Return both sides of a rename while keeping ordinary entries to one path. */
type ReviewEntryPathMetadata = Pick<RehearsalReviewEntry, 'oldPath' | 'newPath'>

export function reviewEntryPaths(entry: ReviewEntryPathMetadata): string[] {
  return [
    ...new Set([entry.oldPath, entry.newPath].filter((path): path is string => path !== null))
  ]
}

/** Resolve a city path against the complete review metadata map. */
export function reviewEntryForPath<T extends ReviewEntryPathMetadata>(
  entries: T[],
  path: string
): T | null {
  return entries.find((entry) => entry.oldPath === path || entry.newPath === path) ?? null
}

export function reviewChangeLabel(change: RehearsalReviewChange): string {
  if (change === 'added') return 'Added'
  if (change === 'deleted') return 'Deleted'
  if (change === 'renamed') return 'Renamed'
  if (change === 'typechange') return 'Type changed'
  return 'Modified'
}

export function reviewEntryMarkers(
  entries: Array<RehearsalReviewEntry | RehearsalReviewEntrySummary>
): RehearsalReviewMarker[] {
  return entries.flatMap((entry) =>
    reviewEntryPaths(entry).map((path) => ({
      path,
      change: entry.change,
      label: reviewChangeLabel(entry.change)
    }))
  )
}

export function snapshotHasPath(snapshot: Snapshot, path: string): boolean {
  return snapshot.files.some((file) => file.path === path)
}
