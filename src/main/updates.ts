import type { UpdateInfo } from '../shared/types'

/**
 * Lightweight update checker. Instead of pulling in electron-updater (a new
 * runtime dependency — against this project's standing "no new runtime deps"
 * rule) we simply ask GitHub's public Releases API whether a newer tag exists
 * and, if so, surface a banner that links to the download. No token, no
 * background download, no code signing needed — the user stays in control of
 * installing. Everything here fails soft: any network/parse error → null (the
 * app just doesn't show a banner).
 */
const GITHUB_REPO = 'maximalcode/git-city'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/** Parse a semver-ish string ("v0.6.0", "0.6.0") into numeric parts. */
export function parseSemver(raw: string): number[] {
  return raw
    .trim()
    .replace(/^v/i, '')
    .split('-')[0] // drop any pre-release suffix
    .split('.')
    .map((p) => parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0))
}

/** True when `latest` is a strictly higher version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

interface RawRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
}

/**
 * Map a GitHub release payload to an UpdateInfo, or null when it is not a
 * usable newer stable release. Pure — unit-tested with fixture JSON.
 */
export function parseRelease(raw: RawRelease, currentVersion: string): UpdateInfo | null {
  if (!raw || typeof raw.tag_name !== 'string') return null
  if (raw.draft || raw.prerelease) return null
  if (!isNewer(raw.tag_name, currentVersion)) return null
  const notes = (raw.body ?? '').trim().slice(0, 1200)
  return {
    version: raw.tag_name.replace(/^v/i, ''),
    name: raw.name?.trim() || raw.tag_name,
    notes,
    url:
      typeof raw.html_url === 'string'
        ? raw.html_url
        : `https://github.com/${GITHUB_REPO}/releases`,
    publishedAt: raw.published_at ?? null
  }
}

/**
 * Ask GitHub for the latest release and return update info if it is newer than
 * the running version. Returns null on any error (offline, rate-limited, no
 * releases yet) so the caller can treat "no update" and "couldn't check"
 * identically.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'git-city'
      },
      signal: controller.signal
    })
    if (!res.ok) return null
    const raw = (await res.json()) as RawRelease
    return parseRelease(raw, currentVersion)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
