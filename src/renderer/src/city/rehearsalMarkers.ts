import type { RehearsalReviewChange, RehearsalReviewEntry, Snapshot } from '../../../shared/types'

export interface RehearsalReviewMarker {
  path: string
  change: RehearsalReviewChange
  label: string
}

/** Return both sides of a rename while keeping ordinary entries to one path. */
export function reviewEntryPaths(entry: RehearsalReviewEntry): string[] {
  return [
    ...new Set([entry.oldPath, entry.newPath].filter((path): path is string => path !== null))
  ]
}

export function reviewChangeLabel(change: RehearsalReviewChange): string {
  if (change === 'added') return 'Added'
  if (change === 'deleted') return 'Deleted'
  if (change === 'renamed') return 'Renamed'
  if (change === 'typechange') return 'Type changed'
  return 'Modified'
}

export function reviewEntryMarkers(entries: RehearsalReviewEntry[]): RehearsalReviewMarker[] {
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
