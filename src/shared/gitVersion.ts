import type { GitVersion } from './types'

/**
 * Which git versions Git City can trust.
 *
 * The history replay leans entirely on `git log --first-parent --raw
 * --numstat` reporting a diff for merge commits. Git 2.31 (2021) is where that
 * became reliable; before it, merges come back with no file list at all, so
 * every file that only ever arrived through a merge is simply absent from the
 * city and every telescoped line count downstream of one is wrong.
 *
 * That is the reason this is a hard block rather than a warning. A missing git
 * announces itself; an old git draws a plausible, confidently wrong city — the
 * HUD counts look fine, the buildings look fine, and nothing anywhere says the
 * picture is a lie. Better to refuse.
 *
 * Adding `--diff-merges=first-parent` is NOT an alternative: that option does
 * not exist on those versions either, so it would turn silent wrongness into a
 * hard failure for the same users.
 */
export const MIN_GIT: readonly [number, number] = [2, 31]

/**
 * Pull [major, minor] out of a `git --version` line.
 *
 * The wild forms this has to survive: "git version 2.39.3",
 * "git version 2.39.3 (Apple Git-146)" on macOS, and
 * "git version 2.45.2.windows.1" on Windows.
 */
export function parseGitVersion(raw: string): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(raw)
  if (!m) return null
  const major = parseInt(m[1], 10)
  const minor = parseInt(m[2], 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
  return [major, minor]
}

/** Describe a `git --version` line: parsed, and whether we can work with it. */
export function describeGitVersion(raw: string): GitVersion {
  const parts = parseGitVersion(raw)
  // An unparseable version is treated as supported: a fork or a distribution
  // we've never seen printing something odd is far likelier than a genuinely
  // ancient git, and refusing to start on a guess is the worse failure.
  if (!parts) return { raw, parts: null, supported: true }
  const [major, minor] = parts
  const supported = major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1])
  return { raw, parts, supported }
}

/** The sentence shown when a git is too old to draw a correct city. */
export function tooOldMessage(v: GitVersion): string {
  const have = v.parts ? `${v.parts[0]}.${v.parts[1]}` : v.raw
  return (
    `Git City needs git ${MIN_GIT[0]}.${MIN_GIT[1]} or newer (you have ${have}). ` +
    `Older versions don't report the files changed by a merge commit, so the city ` +
    `would be missing files and drawn at the wrong sizes. ` +
    `Update git from git-scm.com, then restart Git City.`
  )
}
