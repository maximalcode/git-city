import { describe, it, expect } from 'vitest'
import { deriveCi, parsePrFiles } from './github'

describe('deriveCi', () => {
  it('returns none for no checks', () => {
    expect(deriveCi([])).toBe('none')
    expect(deriveCi(undefined)).toBe('none')
    expect(deriveCi(null)).toBe('none')
  })

  it('passing when every check succeeded', () => {
    const rollup = [
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { state: 'SUCCESS' } // commit status style
    ]
    expect(deriveCi(rollup)).toBe('passing')
  })

  it('failing when any check failed (wins over pending)', () => {
    const rollup = [{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]
    expect(deriveCi(rollup)).toBe('failing')
  })

  it('pending when a check is still running and none failed', () => {
    const rollup = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'QUEUED' }]
    expect(deriveCi(rollup)).toBe('pending')
  })

  it('treats a PENDING commit status as pending', () => {
    expect(deriveCi([{ state: 'PENDING' }])).toBe('pending')
  })

  it('treats ACTION_REQUIRED / TIMED_OUT / CANCELLED as failing', () => {
    expect(deriveCi([{ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }])).toBe('failing')
    expect(deriveCi([{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }])).toBe('failing')
    expect(deriveCi([{ status: 'COMPLETED', conclusion: 'CANCELLED' }])).toBe('failing')
  })
})

describe('parsePrFiles', () => {
  it('maps files with additions/deletions', () => {
    const json = JSON.stringify({
      files: [
        { path: 'src/a.ts', additions: 10, deletions: 2 },
        { path: 'README.md', additions: 1, deletions: 0 }
      ]
    })
    expect(parsePrFiles(json)).toEqual([
      { path: 'src/a.ts', additions: 10, deletions: 2 },
      { path: 'README.md', additions: 1, deletions: 0 }
    ])
  })

  it('defaults missing counts to 0 and drops pathless entries', () => {
    const json = JSON.stringify({ files: [{ path: 'x.ts' }, { additions: 5 }, {}] })
    expect(parsePrFiles(json)).toEqual([{ path: 'x.ts', additions: 0, deletions: 0 }])
  })

  it('returns [] for malformed or empty input', () => {
    expect(parsePrFiles('not json')).toEqual([])
    expect(parsePrFiles('{}')).toEqual([])
    expect(parsePrFiles(JSON.stringify({ files: null }))).toEqual([])
  })
})
