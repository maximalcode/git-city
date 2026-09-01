import { describe, expect, it } from 'vitest'
import {
  classifyCliFailure,
  firstCliLine,
  listFailureReason,
  opFailure,
  repoProbeFailure,
  TIMED_OUT,
  unreachable
} from './cliFailure'
import type { CliResult } from './cliRunner'
import type { CliWording, RepoProbeWording } from './cliFailure'

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

/**
 * The lifted failure wording (#109). Both providers' exact strings go through
 * the same helper here, to prove the parameterization changes no wording —
 * only the names dropped into the sentences.
 */
const GH: CliWording = { missing: 'gh missing', cli: 'gh', subject: 'GitHub' }
const GL: CliWording = { missing: 'glab missing', cli: 'glab', subject: 'GitLab' }

const failed = (stderr: string): CliResult => ({
  code: 1,
  stdout: '',
  stderr,
  missing: false
})
const absent = (): CliResult => ({ code: -1, stdout: '', stderr: 'spawn ENOENT', missing: true })

describe('listFailureReason', () => {
  it('returns the missing-CLI sentence untouched', () => {
    expect(listFailureReason(absent(), GH)).toBe('gh missing')
    expect(listFailureReason(absent(), GL)).toBe('glab missing')
  })

  it('words our own timeout with the CLI name', () => {
    const out: CliResult = { ...failed(''), stderr: `something\n${TIMED_OUT}` }
    expect(listFailureReason(out, GH)).toBe(
      "gh didn't respond within 20s — check your network or VPN, then ↻."
    )
    expect(listFailureReason(out, GL)).toBe(
      "glab didn't respond within 20s — check your network or VPN, then ↻."
    )
  })

  it('words offline with the forge name', () => {
    expect(listFailureReason(failed('dial tcp: no such host'), GH)).toBe(
      "Couldn't reach GitHub — check your network, then ↻."
    )
    expect(listFailureReason(failed('dial tcp: no such host'), GL)).toBe(
      "Couldn't reach GitLab — check your network, then ↻."
    )
  })

  it('shows the CLI first line for anything else', () => {
    expect(listFailureReason(failed('error: 502 bad gateway'), GH)).toBe(
      "Couldn't reach GitHub: 502 bad gateway Try ↻."
    )
    expect(listFailureReason(failed('  \n '), GL)).toBe("Couldn't reach GitLab. Try ↻.")
  })
})

describe('unreachable', () => {
  it('words the two reachability sentences with the forge name', () => {
    expect(unreachable('GitHub', 'timeout')).toEqual({
      reason: "GitHub didn't respond within 20s — check your network or VPN, then ↻.",
      hint: 'retry'
    })
    expect(unreachable('GitLab', 'offline')).toEqual({
      reason: "Can't reach GitLab — check your network connection, then ↻.",
      hint: 'retry'
    })
  })
})

describe('repoProbeFailure', () => {
  const gh: RepoProbeWording = {
    ...GH,
    noun: 'repository',
    authPattern: /not logged (in )?to|authentication|gh auth login|HTTP 401/i,
    notFoundPattern: /no such remote|not a git repository|could not determine|no git remotes/i
  }
  const gl: RepoProbeWording = {
    ...GL,
    noun: 'project',
    authPattern: /401|unauthorized|not authenticated|glab auth login/i,
    notFoundPattern: /404|not found|no such remote|could not determine/i
  }

  it('routes offline and timeouts to the reachability wording', () => {
    expect(repoProbeFailure(failed('connection refused'), '', gh)).toEqual({
      reason: "Can't reach GitHub — check your network connection, then ↻.",
      hint: 'retry'
    })
    const out: CliResult = { ...failed(''), stderr: TIMED_OUT }
    expect(repoProbeFailure(out, '', gl)).toEqual({
      reason: "GitLab didn't respond within 20s — check your network or VPN, then ↻.",
      hint: 'retry'
    })
  })

  it('names the host from the origin when the CLI refuses the account', () => {
    const refused = failed('HTTP 401: Bad credentials')
    expect(repoProbeFailure(refused, 'git@git.acme.com:team/thing.git', gh)).toEqual({
      reason: 'gh is not logged in to git.acme.com — run: gh auth login --hostname git.acme.com',
      hint: 'login'
    })
    expect(repoProbeFailure(refused, 'https://gitlab.acme.com/g/r.git', gl)).toEqual({
      reason:
        'glab is not logged in to gitlab.acme.com — run: glab auth login --hostname gitlab.acme.com',
      hint: 'login'
    })
  })

  it('falls back to a hostless login sentence when the origin has no hostname', () => {
    expect(repoProbeFailure(failed('HTTP 401: Bad credentials'), '', gh)).toEqual({
      reason: 'gh is not logged in to this host — run: gh auth login',
      hint: 'login'
    })
  })

  it('says there is no remote when the CLI does not know the repository', () => {
    expect(repoProbeFailure(failed('no such remote: origin'), '', gh)).toEqual({
      reason: 'This repository has no GitHub remote.',
      hint: 'none'
    })
    expect(repoProbeFailure(failed('404 Not found'), '', gl)).toEqual({
      reason: 'This repository has no GitLab remote.',
      hint: 'none'
    })
  })

  it('shows the CLI first line when nothing matched', () => {
    expect(repoProbeFailure(failed('error: 502 bad gateway'), '', gh)).toEqual({
      reason: 'gh could not read this repository (502 bad gateway)',
      hint: 'retry'
    })
    expect(repoProbeFailure(failed('  \n '), '', gl)).toEqual({
      reason: 'glab could not read this project.',
      hint: 'retry'
    })
  })
})

describe('opFailure', () => {
  it('names the missing CLI when there is none', () => {
    expect(opFailure(absent(), 'gh missing', 'fallback')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'gh missing'
    })
  })

  it('prefers trimmed stderr, then the fallback', () => {
    expect(opFailure(failed('  oops \n'), 'gh missing', 'fallback')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'oops'
    })
    expect(opFailure(failed(''), 'gh missing', 'fallback')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'fallback'
    })
  })
})
