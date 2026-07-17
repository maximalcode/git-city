import { describe, expect, it } from 'vitest'
import type { ConflictSegment } from '../../../shared/types'
import { assemble, type Choice } from './MergeView'

const segs: ConflictSegment[] = [
  { kind: 'text', text: 'before\n' },
  { kind: 'conflict', id: 0, ours: 'ours\n', theirs: 'theirs\n', oursLabel: 'HEAD', theirsLabel: 'feat' },
  { kind: 'text', text: 'after\n' }
]

const m = <V,>(entries: [number, V][] = []): Map<number, V> => new Map(entries)

describe('MergeView assemble', () => {
  it('defaults an untouched hunk to ours', () => {
    expect(assemble(segs, m<Choice>(), m<string>())).toBe('before\nours\nafter\n')
  })

  it('resolves theirs and both', () => {
    expect(assemble(segs, m<Choice>([[0, 'theirs']]), m())).toBe('before\ntheirs\nafter\n')
    expect(assemble(segs, m<Choice>([[0, 'both']]), m())).toBe('before\nours\ntheirs\nafter\n')
  })

  it('uses the edit buffer when present', () => {
    expect(assemble(segs, m<Choice>([[0, 'edit']]), m([[0, 'custom\n']]))).toBe(
      'before\ncustom\nafter\n'
    )
  })

  it('an untouched edit writes exactly what the textarea displayed (ours+theirs)', () => {
    // regression: this used to fall back to ours only, silently writing
    // different text than the user saw
    expect(assemble(segs, m<Choice>([[0, 'edit']]), m())).toBe('before\nours\ntheirs\nafter\n')
  })
})
