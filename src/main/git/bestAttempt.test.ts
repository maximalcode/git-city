import { describe, expect, it } from 'vitest'
import type { HostAuth } from '../../shared/types'
import { bestAttempt } from './host'

const missing = (host: 'github' | 'gitlab'): HostAuth => ({
  host,
  available: false,
  authed: false,
  isRepo: false,
  login: null,
  reason: `${host} CLI not found.`,
  hint: 'install'
})

const saidNo = (host: 'github' | 'gitlab'): HostAuth => ({
  host,
  available: true,
  authed: true,
  isRepo: false,
  login: 'me',
  reason: `This repository has no ${host} remote.`,
  hint: 'none'
})

const offline = (host: 'github' | 'gitlab'): HostAuth => ({
  host,
  available: true,
  authed: false,
  isRepo: false,
  login: null,
  reason: `Can't reach ${host}.`,
  hint: 'retry'
})

/**
 * What the panel is told when nobody claimed a self-hosted repository.
 *
 * The old code discarded all of this and rendered "This repository has no
 * GitHub or GitLab remote." — false for a self-hosted GitLab user — followed
 * by an instruction to install `gh`, the wrong tool (#24).
 */
describe('bestAttempt', () => {
  const origin = 'git@git.acme.com:team/thing.git'

  it('says neither CLI is installed, and names the host, when neither is', () => {
    const auth = bestAttempt([missing('gitlab'), missing('github')], origin)
    expect(auth.reason).toContain('git.acme.com')
    expect(auth.reason).toContain('gh')
    expect(auth.reason).toContain('glab')
    expect(auth.hint).toBe('install')
  })

  it('falls back to a neutral phrase when the origin has no hostname', () => {
    expect(bestAttempt([missing('gitlab'), missing('github')], '').reason).toContain('this remote')
  })

  it('keeps the reason of the CLI that could actually answer', () => {
    // glab is missing, gh is offline: "check your network" beats "install glab"
    const auth = bestAttempt([missing('gitlab'), offline('github')], origin)
    expect(auth.hint).toBe('retry')
    expect(auth.host).toBe('github')
  })

  it('reports the missing CLI when the other one simply said no', () => {
    const auth = bestAttempt([missing('gitlab'), saidNo('github')], origin)
    expect(auth.host).toBe('gitlab')
    expect(auth.hint).toBe('install')
  })

  it('only claims "no GitHub or GitLab remote" when both were there and said no', () => {
    const auth = bestAttempt([saidNo('gitlab'), saidNo('github')], origin)
    expect(auth.host).toBe('unknown')
    expect(auth.reason).toBe('This repository has no GitHub or GitLab remote.')
    expect(auth.hint).toBe('none')
  })

  it('does not invent a verdict from no attempts at all', () => {
    expect(bestAttempt([], origin).host).toBe('unknown')
  })
})
