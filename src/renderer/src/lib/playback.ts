/**
 * Playback pacing for the build-the-city animation.
 *
 * Constraints (user requirement):
 *  - the whole replay finishes within PLAY_TOTAL_MS (10s)
 *  - never slower than 1 snapshot per second (PLAY_STEP_MAX_MS)
 *  - never so fast the eye can't follow (PLAY_STEP_MIN_MS)
 */
export const PLAY_TOTAL_MS = 10_000
export const PLAY_STEP_MIN_MS = 150
export const PLAY_STEP_MAX_MS = 1_000

export function playStepMs(snapshotCount: number): number {
  const steps = Math.max(1, snapshotCount - 1) // transitions between snapshots, not states
  return Math.min(PLAY_STEP_MAX_MS, Math.max(PLAY_STEP_MIN_MS, PLAY_TOTAL_MS / steps))
}
