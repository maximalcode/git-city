import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import type { ProgressInfo } from '../../shared/types'
import { runGitResult, searchPath } from './exec'
import { remoteEnv } from './remoteEnv'
import { classifyGitError, FriendlyError } from './result'

/** Derive a safe directory name from a repo URL, e.g. ".../expressjs/express.git" → "express". */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '')
  const name = cleaned.split(/[/:]/).pop() ?? ''
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!safe) throw new Error('Could not derive a repository name from that URL.')
  return safe
}

/**
 * Do two remote URLs point at the same repository?
 *
 * Compared after dropping a trailing slash, a `.git` suffix and case, because
 * `https://github.com/expressjs/express`,
 * `https://github.com/expressjs/express.git` and
 * `https://github.com/expressjs/express/` are one repository and the user may
 * type any of them. Deliberately *not* clever about scp-vs-https or host
 * aliases: a false "same" silently opens the wrong repository, while a false
 * "different" only costs a second clone into `<name>-2`.
 */
export function sameRemote(a: string, b: string): boolean {
  const norm = (u: string): string =>
    u
      .trim()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Pick a directory for a clone of `url` under `clonesDir`.
 *
 * The name comes from the URL, so a fork and its upstream — `express` and
 * `express` — collide, and the old code simply reused whichever was cloned
 * first. Nothing on screen ever named the URL actually opened, so the user
 * could commit and push against the wrong origin (#25). Now an existing clone
 * is only reused when its `origin` really is the URL asked for; otherwise the
 * next free `<name>-2`, `<name>-3` is used.
 *
 * `originOf` is injected so this is testable without cloning anything.
 */
export async function destinationFor(
  url: string,
  clonesDir: string,
  originOf: (dir: string) => Promise<string | null>
): Promise<{ dest: string; reuse: boolean }> {
  const base = repoNameFromUrl(url)
  for (let n = 1; n < 100; n++) {
    const dest = join(clonesDir, n === 1 ? base : `${base}-${n}`)
    if (!existsSync(join(dest, '.git'))) return { dest, reuse: false }
    const origin = await originOf(dest)
    // An existing clone with no readable origin is not something to reuse
    // blindly — it may be half-cloned, or pointed somewhere else entirely.
    if (origin && sameRemote(origin, url)) return { dest, reuse: true }
  }
  throw new FriendlyError(
    `There are already 99 clones named "${base}". Clone this one yourself and open the folder instead.`
  )
}

/**
 * Turn a failed clone into a sentence.
 *
 * git's own stderr used to reach the Welcome screen verbatim — "fatal: could
 * not read Username for 'https://github.com': No such device or address" — which
 * never says the URL might be misspelled or private, and leaks the app's
 * internal clones directory along the way (#25).
 */
export function cloneFailureMessage(text: string): string {
  const code = classifyGitError(text)
  if (code === 'auth' || /not found|does not exist|repository .* not found/i.test(text)) {
    return (
      'That repository is private, or does not exist. Git City clones public ' +
      'repositories only — check the URL, or clone it yourself and open the folder.'
    )
  }
  if (/could not resolve host|unable to access|connection refused|timed out/i.test(text)) {
    return 'Could not reach that host. Check the URL and your network connection.'
  }
  return 'Could not clone that repository. Check the URL, or clone it yourself and open the folder.'
}

/** Clone `url` into `<baseDir>/clones/<name>`; baseDir is injected so this stays testable without Electron. */
export async function cloneRepo(
  url: string,
  baseDir: string,
  onProgress: (p: ProgressInfo) => void
): Promise<string> {
  const trimmed = url.trim()
  if (!/^(https?:\/\/|git@)/.test(trimmed)) {
    throw new FriendlyError('Please enter an https:// or git@ repository URL.')
  }
  const clonesDir = join(baseDir, 'clones')
  await mkdir(clonesDir, { recursive: true })

  const { dest, reuse } = await destinationFor(trimmed, clonesDir, readOrigin)
  if (reuse) return dest

  const git = simpleGit({
    progress({ progress }) {
      onProgress({ phase: 'cloning', done: progress, total: 100 })
    }
    // The clone was the one remote call still inheriting the whole process
    // environment, so a GUI credential helper could hang it forever with no
    // cancel on screen. remoteEnv pins GIT_TERMINAL_PROMPT=0 (#25).
  }).env(remoteEnv(process.env, { PATH: searchPath() }))

  try {
    await git.clone(trimmed, dest)
  } catch (err) {
    throw new FriendlyError(cloneFailureMessage(err instanceof Error ? err.message : String(err)))
  }
  return dest
}

/** `origin`'s URL for an existing clone, or null when there isn't one. */
async function readOrigin(dir: string): Promise<string | null> {
  const res = await runGitResult(dir, ['remote', 'get-url', 'origin']).catch(() => null)
  if (!res || res.code !== 0) return null
  return res.stdout.trim() || null
}
