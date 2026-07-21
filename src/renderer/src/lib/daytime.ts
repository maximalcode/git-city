/**
 * Map a commit timestamp to the scene's time-of-day (0..1, where 0/1 =
 * midnight and 0.5 = noon), so "sun follows commit time" makes a 9am commit
 * render under morning light and a late-night commit under a dark sky.
 *
 * Uses the LOCAL hour of the timestamp (what the author's clock read), which
 * is what makes the mapping feel intuitive — a commit made at breakfast looks
 * like morning regardless of the viewer's timezone.
 */
export function timeOfDayFromCommit(unixMs: number): number {
  if (!Number.isFinite(unixMs)) return 0.5
  const d = new Date(unixMs)
  const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
  return hours / 24
}

/** Short "9:04 AM"-style label for the ticker (locale-aware, no seconds). */
export function commitTimeLabel(unixMs: number): string {
  if (!Number.isFinite(unixMs)) return ''
  return new Date(unixMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })
}
