import { describe, it, expect } from 'vitest'
import { deriveCi } from './github'

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
