import { describe, expect, it } from 'vitest'
import { PLAY_STEP_MAX_MS, PLAY_STEP_MIN_MS, PLAY_TOTAL_MS, playStepMs } from './playback'

describe('playStepMs', () => {
  it('finishes a 50-snapshot replay within the total budget', () => {
    const step = playStepMs(50)
    expect(step * 49).toBeLessThanOrEqual(PLAY_TOTAL_MS)
    expect(step).toBeCloseTo(10_000 / 49, 5)
  })

  it('never steps slower than 1 snapshot per second', () => {
    for (const n of [1, 2, 3, 5, 11, 50, 200]) {
      expect(playStepMs(n)).toBeLessThanOrEqual(PLAY_STEP_MAX_MS)
    }
  })

  it('caps tiny replays at the max step (still < total budget)', () => {
    expect(playStepMs(2)).toBe(PLAY_STEP_MAX_MS)
    expect(playStepMs(5)).toBe(PLAY_STEP_MAX_MS)
  })

  it('handles degenerate snapshot counts without dividing by zero', () => {
    expect(playStepMs(1)).toBe(PLAY_STEP_MAX_MS)
    expect(playStepMs(0)).toBe(PLAY_STEP_MAX_MS)
  })

  it('clamps very long replays at the readability floor', () => {
    expect(playStepMs(200)).toBeGreaterThanOrEqual(PLAY_STEP_MIN_MS)
    expect(playStepMs(10_000)).toBe(PLAY_STEP_MIN_MS)
  })
})
