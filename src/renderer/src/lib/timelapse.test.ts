import { describe, expect, it } from 'vitest'
import { pickTimelapseMime, timelapseFileName, TIMELAPSE_MIME_CANDIDATES } from './timelapse'

describe('pickTimelapseMime', () => {
  it('returns the first supported candidate, best first', () => {
    expect(pickTimelapseMime(() => true)).toBe(TIMELAPSE_MIME_CANDIDATES[0])
  })

  it('falls through to a later candidate when the best is unsupported', () => {
    const only = 'video/webm'
    expect(pickTimelapseMime((m) => m === only)).toBe(only)
  })

  it('returns null when nothing is supported', () => {
    expect(pickTimelapseMime(() => false)).toBeNull()
  })

  it('treats a throwing check as unsupported', () => {
    expect(
      pickTimelapseMime(() => {
        throw new Error('boom')
      })
    ).toBeNull()
  })
})

describe('timelapseFileName', () => {
  const d = new Date(2026, 6, 19) // 2026-07-19 (month is 0-based)

  it('slugifies the repo name and stamps the date', () => {
    expect(timelapseFileName('My Repo!', d)).toBe('git-city-my-repo-timelapse-20260719.webm')
  })

  it('pads month and day', () => {
    expect(timelapseFileName('x', new Date(2026, 0, 5))).toBe('git-city-x-timelapse-20260105.webm')
  })

  it('falls back to "repo" for an empty slug', () => {
    expect(timelapseFileName('---', d)).toBe('git-city-repo-timelapse-20260719.webm')
  })
})
