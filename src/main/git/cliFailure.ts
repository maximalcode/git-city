/**
 * Reading a forge CLI's failure.
 *
 * `gh` and `glab` both report "I could not reach the API" and "you are not
 * logged in" with the same exit code, and the panel used to collapse both into
 * "Not logged in — run: gh auth login". Told that while merely offline, a user
 * follows the instruction, it fails too, and they may log out and
 * re-authenticate a perfectly valid token for nothing (#24).
 *
 * Shared by both providers because the CLIs are Go programs over the same
 * network stack, and these are the strings that stack produces.
 */

import { stripNoise } from './result'
import type { CliResult } from './cliRunner'
import { hostnameOf } from './hostUrl'
import type { HostAuth, OpResult } from '../../shared/types'

/**
 * How long any forge CLI is given to answer before we kill it.
 *
 * There was no limit at all, so a `gh` call behind a dead VPN left "Loading
 * pull requests…" on screen forever — no elapsed time, no cancel, and the one
 * retry control greyed out by the very state that was stuck (#24).
 */
export const CLI_TIMEOUT_MS = 20_000

/** Markers that mean the CLI never reached the server. */
const OFFLINE =
  /dial tcp|no such host|connection refused|network is unreachable|i\/o timeout|TLS handshake|certificate|EOF\b|context deadline exceeded|proxyconnect|server misbehaving|temporary failure in name resolution/i

/** Our own marker, added when we kill a CLI that never answered. */
export const TIMED_OUT = '__git_city_timeout__'

export type CliFailure =
  /** killed by us after the timeout */
  | 'timeout'
  /** never reached the server */
  | 'offline'
  /** reached it and was refused, or something else entirely */
  | 'other'

export function classifyCliFailure(output: string): CliFailure {
  if (output.includes(TIMED_OUT)) return 'timeout'
  return OFFLINE.test(output) ? 'offline' : 'other'
}

/**
 * First useful line of CLI output, for showing inside our own sentence.
 *
 * Capped, because this goes into a panel and the CLIs are fond of
 * multi-paragraph advice. The prefix-stripping is the shared stripNoise (#113);
 * forge output has no git transport chatter to skip past.
 */
export function firstCliLine(output: string, max = 160): string {
  const line = stripNoise(output)[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// ——— shared failure wording ————————————————————————————————————————————————

/**
 * The provider-specific strings the shared wording takes as parameters — the
 * two CLIs' sentences differ only in the names dropped into them (#109).
 */
export interface CliWording {
  /** shown when the binary is not on PATH */
  missing: string
  /** the CLI's own name, lowercase: "gh didn't respond within…" */
  cli: string
  /** the forge's name, capitalized: "Can't reach GitHub —…" */
  subject: string
}

/** {@link repoProbeFailure} adds what only the repo probe needs to say. */
export interface RepoProbeWording extends CliWording {
  /** what the probe failed to read — "repository" for gh, "project" for glab */
  noun: string
  /** how this CLI phrases "you are not authenticated here" */
  authPattern: RegExp
  /** how this CLI phrases "there is no such repository here" */
  notFoundPattern: RegExp
}

/**
 * Wording for "the CLI was there but could not reach the server" — the
 * HostAuth sentences. `gitlab.ts` had factored this into `unreachable()`;
 * `github.ts` still inlined both sentences twice, which is exactly the
 * divergence shared wording exists to stop (#24, #109).
 */
export function unreachable(
  subject: string,
  failure: Exclude<CliFailure, 'other'>
): { reason: string; hint: HostAuth['hint'] } {
  return {
    reason:
      failure === 'timeout'
        ? `${subject} didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
        : `Can't reach ${subject} — check your network connection, then ↻.`,
    hint: 'retry'
  }
}

/**
 * Why a list/files call failed — one sentence shown where the list would have
 * been. Identical control flow in both adapters; only {@link CliWording}
 * differs (#109).
 */
export function listFailureReason(res: CliResult, w: CliWording): string {
  if (res.missing) return w.missing
  const failure = classifyCliFailure(res.stderr + res.stdout)
  if (failure === 'timeout') {
    return `${w.cli} didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
  }
  if (failure === 'offline') return `Couldn't reach ${w.subject} — check your network, then ↻.`
  const detail = firstCliLine(res.stderr + res.stdout)
  return detail
    ? `Couldn't reach ${w.subject}: ${detail} Try ↻.`
    : `Couldn't reach ${w.subject}. Try ↻.`
}

/**
 * Why the repo/project probe failed — the same four branches both adapters
 * ran; gitlab.ts's `projectFailure` even said so in prose ("mirrors gh's
 * repoViewFailure (#24)"). Now it is literally one function. What genuinely
 * differs — how each CLI phrases "not authenticated here" and "no such
 * repository" — travels in as patterns (#109).
 *
 * Everything here used to be "This repository has no GitHub remote." — a bare
 * sentence with no next step, shown while the origin was plainly a forge URL.
 * The CLI's own stderr was discarded, and for an unauthorized self-hosted host
 * it now names the exact command to run (#24).
 */
export function repoProbeFailure(
  res: CliResult,
  origin: string,
  w: RepoProbeWording
): { reason: string; hint: HostAuth['hint'] } {
  const output = res.stderr + res.stdout
  const failure = classifyCliFailure(output)
  if (failure !== 'other') return unreachable(w.subject, failure)
  // An Enterprise/self-hosted host the account has never logged in to. The
  // CLI says so; the hostname comes from the origin so the command we print
  // is the one that will work (#24).
  if (w.authPattern.test(output)) {
    const host = hostnameOf(origin)
    return {
      reason: host
        ? `${w.cli} is not logged in to ${host} — run: ${w.cli} auth login --hostname ${host}`
        : `${w.cli} is not logged in to this host — run: ${w.cli} auth login`,
      hint: 'login'
    }
  }
  if (w.notFoundPattern.test(output)) {
    return { reason: `This repository has no ${w.subject} remote.`, hint: 'none' }
  }
  const detail = firstCliLine(output)
  return {
    reason: detail
      ? `${w.cli} could not read this ${w.noun} (${detail})`
      : `${w.cli} could not read this ${w.noun}.`,
    hint: 'retry'
  }
}

/**
 * A failed write operation → the uniform OpResult, naming the missing CLI
 * when there isn't one. Was `fail()` in both adapters, byte-identical (#109).
 */
export function opFailure(res: CliResult, missing: string, fallback: string): OpResult {
  const message = res.missing ? missing : res.stderr.trim() || fallback
  return { ok: false, code: 'unknown', message }
}
