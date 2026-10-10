import { describe, expect, it } from 'vitest'
import type { RehearsalReviewEntry, Snapshot } from '../../../shared/types'
import {
  reviewEntryForPath,
  reviewEntryMarkers,
  reviewEntryPaths,
  snapshotHasPath
} from './rehearsalMarkers'

function entry(overrides: Partial<RehearsalReviewEntry>): RehearsalReviewEntry {
  return {
    entryId: 'entry',
    change: 'modified',
    oldPath: 'same-lines.ts',
    newPath: 'same-lines.ts',
    old: { present: true, mode: '100644', objectId: 'old' },
    new: { present: true, mode: '100644', objectId: 'new' },
    binary: false,
    type: 'text',
    rename: 'not-applicable',
    text: { changes: 'available', before: 'available', after: 'available' },
    lines: { before: 2, after: 2, additions: 1, deletions: 1 },
    ...overrides
  }
}

function snapshot(paths: string[]): Snapshot {
  return {
    hash: 'snapshot',
    date: 0,
    author: 'author',
    message: 'message',
    index: 0,
    files: paths.map((path) => ({
      path,
      loc: 1,
      commits: 1,
      lastTouched: 0,
      lastAuthor: 'author',
      binary: false
    }))
  }
}

describe('rehearsal city markers', () => {
  it('keeps both endpoints for a rename and preserves same-LOC modified status', () => {
    const rename = entry({
      entryId: 'rename',
      change: 'renamed',
      oldPath: 'old.ts',
      newPath: 'new.ts'
    })
    expect(reviewEntryPaths(rename)).toEqual(['old.ts', 'new.ts'])
    expect(reviewEntryMarkers([rename, entry({})])).toEqual([
      { path: 'old.ts', change: 'renamed', label: 'Renamed' },
      { path: 'new.ts', change: 'renamed', label: 'Renamed' },
      { path: 'same-lines.ts', change: 'modified', label: 'Modified' }
    ])
  })

  it('reports added and deleted paths without inventing a live endpoint', () => {
    expect(
      reviewEntryMarkers([
        entry({ entryId: 'add', change: 'added', oldPath: null, newPath: 'added.ts' }),
        entry({ entryId: 'delete', change: 'deleted', oldPath: 'deleted.ts', newPath: null })
      ])
    ).toEqual([
      { path: 'added.ts', change: 'added', label: 'Added' },
      { path: 'deleted.ts', change: 'deleted', label: 'Deleted' }
    ])
  })

  it('uses the active endpoint to disambiguate a rename from a new path', () => {
    const rename = entry({ entryId: 'rename', change: 'renamed', oldPath: 'a.ts', newPath: 'b.ts' })
    const added = entry({ entryId: 'added', change: 'added', oldPath: null, newPath: 'a.ts' })
    expect(reviewEntryForPath([rename, added], 'a.ts', 'before')?.entryId).toBe('rename')
    expect(reviewEntryForPath([rename, added], 'a.ts', 'after')?.entryId).toBe('added')
    expect(reviewEntryMarkers([rename, added], 'after')).toEqual([
      { path: 'b.ts', change: 'renamed', label: 'Renamed', endpoint: 'after' },
      { path: 'a.ts', change: 'added', label: 'Added', endpoint: 'after' }
    ])
  })

  it('resolves a path from the complete metadata map even when the page omits it', () => {
    const omittedFromPage = entry({ entryId: 'later', newPath: 'src/later.ts' })
    expect(reviewEntryForPath([omittedFromPage], 'src/later.ts')?.entryId).toBe('later')
    expect(reviewEntryForPath([omittedFromPage], 'src/missing.ts')).toBeNull()
  })

  it('checks endpoint presence exactly', () => {
    expect(snapshotHasPath(snapshot(['present.ts']), 'present.ts')).toBe(true)
    expect(snapshotHasPath(snapshot(['present.ts']), 'missing.ts')).toBe(false)
  })
})
