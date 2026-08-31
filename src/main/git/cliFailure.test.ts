import { describe, expect, it } from 'vitest'
import { classifyCliFailure, firstCliLine, TIMED_OUT } from './cliFailure'

/**
 * Every 'offline' here is a case where the panel used to say "Not logged in —
 * run: gh auth login". Following that instruction while offline fails too, and
 * may push someone to re-authenticate a perfectly valid token (#24).
 */
describe('classifyCliFailure', () => {
  it('recognises the ways a Go CLI reports no network', () => {
    for (const output of [
      'dial tcp: lookup api.github.com: no such host',
      'Get "https://api.github.com": dial tcp 140.82.121.6:443: connect: connection refused',
      'net/http: TLS handshake timeout',
      'context deadline exceeded (Client.Timeout exceeded while awaiting headers)',
      'read tcp 10.0.0.2->140.82.121.6:443: i/o timeout',
      'temporary failure in name resolution'
    ]) {
      expect(classifyCliFailure(output), output).toBe('offline')
    }
  })

  it('recognises our own timeout marker', () => {
    expect(classifyCliFailure(`something\n${TIMED_OUT}`)).toBe('timeout')
  })

  it('leaves a genuine auth refusal alone', () => {
    // this one really does mean "log in", and must keep saying so
    expect(classifyCliFailure('You are not logged into any GitHub hosts.')).toBe('other')
    expect(classifyCliFailure('HTTP 401: Bad credentials')).toBe('other')
  })

  it('treats empty output as an ordinary failure', () => {
    expect(classifyCliFailure('')).toBe('other')
  })
})

describe('firstCliLine', () => {
  it('strips the level prefix the CLIs lead with', () => {
    expect(firstCliLine('error: something broke\nmore detail')).toBe('something broke')
  })

  it('skips blank lines rather than returning nothing', () => {
    expect(firstCliLine('\n\n  the real message  \n')).toBe('the real message')
  })

  it('caps a CLI that answers with a paragraph', () => {
    const long = 'x'.repeat(400)
    const out = firstCliLine(long)
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns empty string when there is nothing to show', () => {
    expect(firstCliLine('   \n  ')).toBe('')
  })
})
