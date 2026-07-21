import { describe, expect, it } from 'vitest'
import { commitTimeLabel, timeOfDayFromCommit } from './daytime'

/** build a unix-ms timestamp at a given LOCAL wall-clock time today */
function atLocal(h: number, m = 0): number {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

describe('timeOfDayFromCommit', () => {
  it('maps local midnight to 0', () => {
    expect(timeOfDayFromCommit(atLocal(0))).toBeCloseTo(0, 5)
  })
  it('maps local noon to 0.5', () => {
    expect(timeOfDayFromCommit(atLocal(12))).toBeCloseTo(0.5, 5)
  })
  it('maps 6am to 0.25 and 6pm to 0.75', () => {
    expect(timeOfDayFromCommit(atLocal(6))).toBeCloseTo(0.25, 5)
    expect(timeOfDayFromCommit(atLocal(18))).toBeCloseTo(0.75, 5)
  })
  it('accounts for minutes', () => {
    expect(timeOfDayFromCommit(atLocal(9, 30))).toBeCloseTo(9.5 / 24, 4)
  })
  it('stays within 0..1', () => {
    for (let h = 0; h < 24; h++) {
      const v = timeOfDayFromCommit(atLocal(h))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  it('falls back to noon for a non-finite timestamp', () => {
    expect(timeOfDayFromCommit(NaN)).toBe(0.5)
  })
})

describe('commitTimeLabel', () => {
  it('produces a non-empty label for a real timestamp', () => {
    expect(commitTimeLabel(atLocal(9, 4)).length).toBeGreaterThan(0)
  })
  it('is empty for a non-finite timestamp', () => {
    expect(commitTimeLabel(NaN)).toBe('')
  })
})
