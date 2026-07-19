import { describe, it, expect } from 'vitest'
import { parseCommitLog, looksLikeHash, parseGrep, mapSignature, parseNumstat } from './search'

describe('parseCommitLog', () => {
  it('parses tab-separated log lines into hits', () => {
    const raw = [
      'abcdef1234567890\tAlice\t1700000000\tfix: the thing',
      '0011223344556677\tBob\t1700000100\tfeat: add stuff'
    ].join('\n')
    const hits = parseCommitLog(raw)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toEqual({
      hash: 'abcdef1234567890',
      shortHash: 'abcdef1',
      author: 'Alice',
      date: 1700000000000,
      subject: 'fix: the thing'
    })
  })

  it('keeps tabs that appear inside the subject', () => {
    expect(parseCommitLog('h\tA\t1\tsub\twith\ttabs')[0].subject).toBe('sub\twith\ttabs')
  })

  it('ignores blank lines', () => {
    expect(parseCommitLog('\n\n')).toEqual([])
  })
})

describe('looksLikeHash', () => {
  it('accepts 7–40 hex chars', () => {
    expect(looksLikeHash('abc1234')).toBe(true)
    expect(looksLikeHash('DEADBEEF')).toBe(true)
  })
  it('rejects short or non-hex queries', () => {
    expect(looksLikeHash('abc')).toBe(false)
    expect(looksLikeHash('fix bug')).toBe(false)
    expect(looksLikeHash('zzzzzzz')).toBe(false)
  })
})

describe('parseGrep', () => {
  it('parses path:line:text', () => {
    const hits = parseGrep('src/app.ts:42:  const x = 1')
    expect(hits[0]).toEqual({ path: 'src/app.ts', line: 42, text: '  const x = 1' })
  })
  it('tolerates a colon inside the matched text', () => {
    expect(parseGrep('a.ts:3:key: value')[0]).toEqual({ path: 'a.ts', line: 3, text: 'key: value' })
  })
  it('tolerates a colon inside the path', () => {
    expect(parseGrep('weird:name.ts:9:hit')[0]).toEqual({
      path: 'weird:name.ts',
      line: 9,
      text: 'hit'
    })
  })
  it('skips malformed lines', () => {
    expect(parseGrep('no-colon-here\n')).toEqual([])
  })
})

describe('mapSignature', () => {
  it('maps git %G? codes', () => {
    expect(mapSignature('G')).toBe('good')
    expect(mapSignature('U')).toBe('good')
    expect(mapSignature('B')).toBe('bad')
    expect(mapSignature('N')).toBe('none')
    expect(mapSignature('')).toBe('none')
    expect(mapSignature('X')).toBe('unknown')
  })
})

describe('parseNumstat', () => {
  it('parses additions/deletions/path', () => {
    const files = parseNumstat('4\t2\tsrc/a.ts\n0\t9\tsrc/b.ts')
    expect(files[0]).toEqual({ path: 'src/a.ts', additions: 4, deletions: 2, binary: false })
    expect(files[1]).toEqual({ path: 'src/b.ts', additions: 0, deletions: 9, binary: false })
  })
  it('marks binary files (dash counts) as -1', () => {
    const f = parseNumstat('-\t-\tlogo.png')[0]
    expect(f).toEqual({ path: 'logo.png', additions: -1, deletions: -1, binary: true })
  })
  it('ignores blank lines', () => {
    expect(parseNumstat('\n')).toEqual([])
  })
})
