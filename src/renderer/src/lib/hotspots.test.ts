import { describe, it, expect } from 'vitest'
import { hotspots } from './hotspots'
import type { Snapshot, FileState } from '../../../shared/types'

const DAY = 24 * 60 * 60 * 1000

function file(path: string, over: Partial<FileState> = {}): FileState {
  return {
    path,
    loc: 100,
    commits: 1,
    lastTouched: 0,
    lastAuthor: 'a',
    binary: false,
    ...over
  }
}

function snap(files: FileState[], date = 100 * DAY): Snapshot {
  return { hash: 'h', date, author: 'a', message: 'm', index: 0, files }
}

describe('hotspots', () => {
  const now = 100 * DAY

  it('ranks recent high-churn files first', () => {
    const s = snap([
      file('quiet.ts', { commits: 20, lastTouched: now - 60 * DAY }), // churny but stale
      file('hot.ts', { commits: 8, lastTouched: now - 1 * DAY }),
      file('warm.ts', { commits: 3, lastTouched: now - 2 * DAY })
    ])
    expect(hotspots(s)).toEqual(['hot.ts', 'warm.ts'])
  })

  it('excludes files outside the recency window', () => {
    const s = snap([file('old.ts', { commits: 99, lastTouched: now - 30 * DAY })])
    expect(hotspots(s)).toEqual([])
  })

  it('ignores binary and empty files', () => {
    const s = snap([
      file('bin', { commits: 50, lastTouched: now, binary: true }),
      file('empty', { commits: 50, lastTouched: now, loc: 0 })
    ])
    expect(hotspots(s)).toEqual([])
  })

  it('respects the limit', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      file(`f${i}.ts`, { commits: 10 - i, lastTouched: now - DAY })
    )
    expect(hotspots(snap(files), { limit: 3 })).toEqual(['f0.ts', 'f1.ts', 'f2.ts'])
  })

  it('breaks commit-count ties by most-recently-touched', () => {
    const s = snap([
      file('older.ts', { commits: 5, lastTouched: now - 3 * DAY }),
      file('newer.ts', { commits: 5, lastTouched: now - 1 * DAY })
    ])
    expect(hotspots(s)).toEqual(['newer.ts', 'older.ts'])
  })

  it('empty snapshot yields no hotspots', () => {
    expect(hotspots(snap([]))).toEqual([])
  })
})
