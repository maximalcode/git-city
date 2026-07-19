import type { Snapshot } from '../../../shared/types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface HotspotOptions {
  /** how many hotspots to return (default 5) */
  limit?: number
  /** recency window before the reference time, in ms (default 7 days) */
  windowMs?: number
  /** reference "now"; defaults to the snapshot's own commit date */
  now?: number
}

/**
 * The repo's current hotspots: the files with the most churn that were also
 * touched recently. Ranks files present at `snapshot` whose last change falls
 * within `windowMs` of the reference time, by total commit count (ties broken by
 * most-recently-touched). Returns up to `limit` paths, hottest first.
 *
 * The reference time defaults to the snapshot's own date, so scrubbing through
 * history shows the hotspots *as of* that commit — "what was churning then".
 */
export function hotspots(snapshot: Snapshot, opts: HotspotOptions = {}): string[] {
  const { limit = 5, windowMs = WEEK_MS, now } = opts
  const ref = now ?? snapshot.date
  const recent = snapshot.files.filter(
    (f) => !f.binary && f.loc > 0 && ref - f.lastTouched <= windowMs
  )
  recent.sort((a, b) => b.commits - a.commits || b.lastTouched - a.lastTouched)
  return recent.slice(0, limit).map((f) => f.path)
}
