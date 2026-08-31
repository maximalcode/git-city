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
