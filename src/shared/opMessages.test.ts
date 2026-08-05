import { describe, expect, it } from 'vitest'
import { opMessage } from './opMessages'
import type { OpResult } from './types'

const fail = (partial: Partial<OpResult>): OpResult => ({ ok: false, ...partial })

/**
 * git's first line is written for someone mid-task in a terminal who knows what
 * they typed. In a toast with no context it is often worse than nothing (#26).
 */
describe('opMessage', () => {
  it('replaces the transport line a rejected push leads with', () => {
    // "To github.com:you/repo.git" reads like success, not failure
    const msg = opMessage(fail({ code: 'rejected', message: 'To github.com:you/repo.git' }))
    expect(msg).toBe("The remote has commits you don't have yet. Pull first, then push again.")
  })

  it('names the credential helper for an auth failure', () => {
    expect(opMessage(fail({ code: 'auth', message: 'could not read Username' }))).toContain(
      'SSH key or credential helper'
    )
  })

  it('gives the two commands that fix an unconfigured git', () => {
    const msg = opMessage(fail({ code: 'identity', message: 'Author identity unknown' }))
    expect(msg).toContain('user.name')
    expect(msg).toContain('user.email')
  })

  it('lets a message written for the exact case win over the generic one', () => {
    // detached HEAD classifies as no-upstream, but "use Publish" is wrong there
    const msg = opMessage(
      fail({
        code: 'no-upstream',
        message: 'You are not on a branch (detached HEAD).',
        friendly: true
      })
    )
    expect(msg).toBe('You are not on a branch (detached HEAD).')
  })

  it("keeps git's own text for codes with nothing better to say", () => {
    const msg = opMessage(fail({ code: 'unknown', message: 'error: pathspec did not match' }))
    expect(msg).toBe('error: pathspec did not match')
  })

  it('never returns an empty string', () => {
    expect(opMessage(fail({}))).toBe('Operation failed.')
  })
})
