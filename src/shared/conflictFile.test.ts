import { describe, expect, it } from 'vitest'
import { sameConflict } from './conflictFile'
import type { ConflictFile, ConflictSegment } from './types'

const segs: ConflictSegment[] = [
  { kind: 'text', text: 'before\n' },
  {
    kind: 'conflict',
    id: 0,
    ours: 'ours\n',
    theirs: 'theirs\n',
    oursLabel: 'HEAD',
    theirsLabel: 'feat'
  },
  { kind: 'text', text: 'after\n' }
]

const file = (path: string, segments: ConflictSegment[]): ConflictFile => ({
  path,
  binary: false,
  segments
})

/**
 * The guard between a stale buffer and the user's file. Every "false" here is
 * a write that must not happen — resolving overwrites the file and stages it,
 * and none of it has ever been committed.
 */
describe('sameConflict', () => {
  it('holds for a re-read that changed nothing', () => {
    // the case that lets alt-tabbing away and back keep the user's hunk choices
    expect(sameConflict(file('a.ts', segs), file('a.ts', [...segs]))).toBe(true)
  })

  it('rejects a different path — the buffer belongs to another file', () => {
    expect(sameConflict(file('a.ts', segs), file('b.ts', segs))).toBe(false)
  })

  it('rejects a file the user resolved in their own editor', () => {
    // markers gone, one plain text segment left: writing the old buffer back
    // over this is exactly the overwrite that loses their work
    expect(sameConflict(file('a.ts', segs), file('a.ts', [{ kind: 'text', text: 'done\n' }]))).toBe(
      false
    )
  })

  it('rejects a changed side of a hunk', () => {
    const edited: ConflictSegment[] = [
      segs[0],
      { ...(segs[1] as Extract<ConflictSegment, { kind: 'conflict' }>), theirs: 'theirs v2\n' },
      segs[2]
    ]
    expect(sameConflict(file('a.ts', segs), file('a.ts', edited))).toBe(false)
  })

  it('rejects text that changed around the hunks', () => {
    const edited: ConflictSegment[] = [{ kind: 'text', text: 'before v2\n' }, segs[1], segs[2]]
    expect(sameConflict(file('a.ts', segs), file('a.ts', edited))).toBe(false)
  })

  it('rejects a file that turned binary', () => {
    expect(sameConflict(file('a.ts', []), { path: 'a.ts', binary: true, segments: [] })).toBe(false)
  })
})
