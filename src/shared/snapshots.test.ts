import { describe, expect, it } from 'vitest'
import type { FileState, RepoAnalysis, Snapshot } from './types'
import {
  analysisBytes,
  buildAnalysis,
  compactSnapshot,
  createInterner,
  materializeSnapshot,
  peakLocByPath
} from './snapshots'

const file = (path: string, loc: number, extra: Partial<FileState> = {}): FileState => ({
  path,
  loc,
  commits: 1,
  lastTouched: 1_700_000_000_000,
  lastAuthor: 'ada',
  binary: false,
  ...extra
})

const snap = (index: number, files: FileState[]): Snapshot => ({
  hash: `hash${index}`,
  date: 1_700_000_000_000 + index,
  author: 'ada',
  message: `commit ${index}`,
  index,
  files
})

const info: RepoAnalysis['info'] = { path: '/r', name: 'r', branch: 'main', commitCount: 3 }

describe('compact ↔ materialize round trip', () => {
  it('reproduces every field of every file exactly', () => {
    const original = [
      snap(0, [file('a.ts', 10), file('dir/b.ts', 0, { binary: true, lastAuthor: 'grace' })]),
      snap(2, [file('a.ts', 25, { commits: 3 })])
    ]
    const analysis = buildAnalysis(info, original)
    expect(materializeSnapshot(analysis, 0)).toEqual(original[0])
    expect(materializeSnapshot(analysis, 1)).toEqual(original[1])
  })

  it('keeps commit metadata readable without materializing', () => {
    const analysis = buildAnalysis(info, [snap(0, [file('a.ts', 1)]), snap(5, [])])
    expect(analysis.snapshots[1].hash).toBe('hash5')
    expect(analysis.snapshots[1].index).toBe(5)
    expect(analysis.snapshots.length).toBe(2)
  })

  it('interns each path and author once across snapshots', () => {
    const analysis = buildAnalysis(info, [
      snap(0, [file('a.ts', 1), file('b.ts', 2)]),
      snap(1, [file('a.ts', 3), file('b.ts', 4)])
    ])
    expect(analysis.paths).toEqual(['a.ts', 'b.ts'])
    expect(analysis.authors).toEqual(['ada'])
  })

  it('handles an empty capture (fresh init has no files)', () => {
    const analysis = buildAnalysis(info, [snap(0, [])])
    expect(materializeSnapshot(analysis, 0).files).toEqual([])
  })
})

describe('createInterner on existing tables', () => {
  it('resumes ids append-only, so old snapshots keep resolving', () => {
    const analysis = buildAnalysis(info, [snap(0, [file('a.ts', 1)])])
    const resumed = createInterner(analysis.paths, analysis.authors)
    const next = compactSnapshot(
      resumed,
      { hash: 'h', date: 1, author: 'x', message: 'm', index: 1 },
      [file('a.ts', 2), file('new.ts', 5, { lastAuthor: 'grace' })],
      2
    )
    // same path, same id; new path appended after the existing ones
    expect(Array.from(next.pathId)).toEqual([0, 1])
    expect(analysis.paths).toEqual(['a.ts', 'new.ts'])
    expect(analysis.authors).toEqual(['ada', 'grace'])
    // the pre-existing snapshot still reads correctly through the grown tables
    expect(materializeSnapshot(analysis, 0).files[0].path).toBe('a.ts')
  })
})

describe('peakLocByPath', () => {
  it('takes the maximum across history and forgets nothing', () => {
    const analysis = buildAnalysis(info, [
      snap(0, [file('grew.ts', 10), file('shrank.ts', 500), file('died.ts', 42)]),
      snap(1, [file('grew.ts', 90), file('shrank.ts', 80)])
    ])
    const peak = peakLocByPath(analysis)
    expect(peak.get('grew.ts')).toBe(90)
    expect(peak.get('shrank.ts')).toBe(500)
    // deleted files still peak — the layout is built over the union
    expect(peak.get('died.ts')).toBe(42)
  })

  it('counts a 0-line file as existing, not missing', () => {
    const analysis = buildAnalysis(info, [snap(0, [file('empty.ts', 0)])])
    expect(peakLocByPath(analysis).get('empty.ts')).toBe(0)
  })
})

describe('analysisBytes', () => {
  it('grows with entries, and stays in typed-array territory', () => {
    const many = Array.from({ length: 1000 }, (_, i) => file(`f${i}.ts`, i))
    const analysis = buildAnalysis(info, [snap(0, many)])
    const bytes = analysisBytes(analysis)
    // 25 bytes of columns per entry plus the interned path strings
    expect(bytes).toBeGreaterThan(1000 * 25)
    expect(bytes).toBeLessThan(1000 * 60)
  })
})
