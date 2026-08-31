import { spawn } from 'child_process'
import { searchPath } from './exec'
import type {
  HostAuth,
  OpResult,
  PrFileChange,
  PrFilesResult,
  PrListResult,
  PullRequestInfo
} from '../../shared/types'
import { classifyCliFailure, CLI_TIMEOUT_MS, firstCliLine, TIMED_OUT } from './cliFailure'
import type { HostProvider } from './host'
import { hostnameOf } from './hostUrl'

/**
 * GitHub integration via the `gh` CLI — zero extra auth setup: gh already holds
 * the user's token in the OS keychain, so we shell out and never handle a token
 * ourselves. Non-GitHub repos (or a missing/logged-out gh) degrade to a clear
 * "unavailable" reason rather than an error.
 */

interface GhResult {
  code: number
  stdout: string
  stderr: string
  /** gh binary not found on PATH */
  missing: boolean
}

function runGh(cwd: string, args: string[]): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = spawn('gh', args, {
      cwd,
      env: {
        ...process.env,
        // Finder-launched apps do not see Homebrew's bin — see exec.ts
        PATH: searchPath(),
        GH_PAGER: '',
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
        NO_COLOR: '1'
      }
    })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r: GhResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    // A gh call behind a dead VPN never returns, and the panel's only retry
    // control is disabled by the very loading state that is stuck — so the
    // spinner ran forever and quitting was the exit (#24).
    const timer = setTimeout(() => {
      child.kill()
      finish({ code: -1, stdout, stderr: `${stderr}\n${TIMED_OUT}`, missing: false })
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) =>
      finish({
        code: -1,
        stdout,
        stderr: String(err),
        missing: (err as NodeJS.ErrnoException).code === 'ENOENT'
      })
    )
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr, missing: false }))
  })
}

/** Collapse a PR's statusCheckRollup into a single CI state. Exported for tests. */
export function deriveCi(rollup: unknown): PullRequestInfo['ci'] {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none'
  let pending = false
  for (const c of rollup as Record<string, unknown>[]) {
    const concl = String(c.conclusion ?? c.state ?? '').toUpperCase()
    const status = String(c.status ?? '').toUpperCase()
    if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(concl)) {
      return 'failing'
    }
    // a check that hasn't completed, or a commit status still PENDING
    if ((status && status !== 'COMPLETED') || concl === 'PENDING' || concl === '') pending = true
  }
  return pending ? 'pending' : 'passing'
}

interface RawPr {
  number: number
  title: string
  headRefName: string
  baseRefName: string
  isDraft?: boolean
  url: string
  state?: string
  author?: { login?: string }
  statusCheckRollup?: unknown
}

function mapPr(p: RawPr): PullRequestInfo {
  return {
    number: p.number,
    title: p.title,
    headRef: p.headRefName,
    baseRef: p.baseRefName,
    state: p.state ?? 'OPEN',
    isDraft: !!p.isDraft,
    url: p.url,
    author: p.author?.login ?? '',
    ci: deriveCi(p.statusCheckRollup)
  }
}

const PR_FIELDS = 'number,title,headRefName,baseRefName,isDraft,url,author,statusCheckRollup,state'

/**
 * Deliberately not "gh is not installed". A Finder-launched app cannot see
 * Homebrew's bin without the PATH repair in exec.ts, and telling someone to
 * install what they already have is a dead end they cannot act their way out of.
 */
const GH_MISSING =
  "GitHub CLI (gh) not found. If it is installed, Git City cannot see it on this app's PATH."

/** gh availability + auth + whether this repo is a GitHub repo. */
export async function ghStatus(repoPath: string, origin = ''): Promise<HostAuth> {
  const auth = await runGh(repoPath, ['auth', 'status'])
  if (auth.missing) {
    return {
      host: 'github',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason: GH_MISSING,
      hint: 'install'
    }
  }
  if (auth.code !== 0) {
    // Offline looks exactly like logged out from here, and telling someone
    // whose network is down to re-authenticate is worse than useless (#24).
    const failure = classifyCliFailure(auth.stderr + auth.stdout)
    if (failure !== 'other') {
      return {
        host: 'github',
        available: true,
        authed: false,
        isRepo: false,
        login: null,
        reason:
          failure === 'timeout'
            ? `GitHub didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
            : "Can't reach GitHub — check your network connection, then ↻.",
        hint: 'retry'
      }
    }
    return {
      host: 'github',
      available: true,
      authed: false,
      isRepo: false,
      login: null,
      reason: 'Not logged in to GitHub — run: gh auth login',
      hint: 'login'
    }
  }
  const login = /account (\S+)/.exec(auth.stderr + auth.stdout)?.[1] ?? null
  const repo = await runGh(repoPath, ['repo', 'view', '--json', 'nameWithOwner'])
  if (repo.code === 0) {
    return { host: 'github', available: true, authed: true, isRepo: true, login, reason: null }
  }
  return {
    host: 'github',
    available: true,
    authed: true,
    isRepo: false,
    login,
    ...repoViewFailure(repo, origin)
  }
}

/**
 * Why `gh repo view` failed.
 *
 * Everything here used to be "This repository has no GitHub remote." — a bare
 * sentence with no next step, shown while the origin was plainly a GitHub URL.
 * gh's own stderr was discarded, and for an unauthorized Enterprise host it
 * names the exact command to run (#24).
 */
function repoViewFailure(
  repo: GhResult,
  origin: string
): { reason: string; hint: HostAuth['hint'] } {
  const output = repo.stderr + repo.stdout
  const failure = classifyCliFailure(output)
  if (failure !== 'other') {
    return {
      reason:
        failure === 'timeout'
          ? `GitHub didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
          : "Can't reach GitHub — check your network connection, then ↻.",
      hint: 'retry'
    }
  }
  // An Enterprise host the account has never logged in to. gh says so; hostname
  // comes from the origin so the command we print is the one that will work.
  if (/not logged (in )?to|authentication|gh auth login|HTTP 401/i.test(output)) {
    const host = hostnameOf(origin)
    return {
      reason: host
        ? `gh is not logged in to ${host} — run: gh auth login --hostname ${host}`
        : 'gh is not logged in to this host — run: gh auth login',
      hint: 'login'
    }
  }
  if (/no such remote|not a git repository|could not determine|no git remotes/i.test(output)) {
    return { reason: 'This repository has no GitHub remote.', hint: 'none' }
  }
  const detail = firstCliLine(output)
  return {
    reason: detail
      ? `gh could not read this repository (${detail})`
      : 'gh could not read this repository.',
    hint: 'retry'
  }
}

/**
 * Ask for one more than we show, so a capped list can say it is capped rather
 * than presenting the first 50 as the whole truth (#24).
 */
const PR_PAGE = 50

export async function listPullRequests(repoPath: string): Promise<PrListResult> {
  const res = await runGh(repoPath, [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    String(PR_PAGE + 1),
    '--json',
    PR_FIELDS
  ])
  if (res.code !== 0) return { ok: false, reason: listFailureReason(res) }
  try {
    const all = (JSON.parse(res.stdout) as RawPr[]).map(mapPr)
    return { ok: true, prs: all.slice(0, PR_PAGE), more: all.length > PR_PAGE }
  } catch {
    return { ok: false, reason: "Couldn't read the response from gh. Try ↻." }
  }
}

function listFailureReason(res: GhResult): string {
  if (res.missing) return GH_MISSING
  const failure = classifyCliFailure(res.stderr + res.stdout)
  if (failure === 'timeout') {
    return `gh didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
  }
  if (failure === 'offline') return "Couldn't reach GitHub — check your network, then ↻."
  const detail = firstCliLine(res.stderr + res.stdout)
  return detail ? `Couldn't reach GitHub: ${detail} Try ↻.` : "Couldn't reach GitHub. Try ↻."
}

/** The open PR whose head is the current branch, or null. */
export async function currentBranchPr(repoPath: string): Promise<PullRequestInfo | null> {
  const res = await runGh(repoPath, ['pr', 'view', '--json', PR_FIELDS])
  if (res.code !== 0) return null
  try {
    const p = JSON.parse(res.stdout) as RawPr
    if (p.state && p.state !== 'OPEN') return null
    return mapPr(p)
  } catch {
    return null
  }
}

interface RawPrFile {
  path?: string
  additions?: number
  deletions?: number
}

/** Pure: map `gh pr view --json files` output to changed-file records. */
export function parsePrFiles(stdout: string): PrFileChange[] {
  try {
    const parsed = JSON.parse(stdout) as { files?: RawPrFile[] }
    const files = Array.isArray(parsed.files) ? parsed.files : []
    return files
      .filter(
        (f): f is RawPrFile & { path: string } => typeof f.path === 'string' && f.path.length > 0
      )
      .map((f) => ({
        path: f.path,
        additions: typeof f.additions === 'number' ? f.additions : 0,
        deletions: typeof f.deletions === 'number' ? f.deletions : 0
      }))
  } catch {
    return []
  }
}

/** The files a PR changes, for lighting them up in the scene. */
export async function pullRequestFiles(repoPath: string, number: number): Promise<PrFilesResult> {
  const res = await runGh(repoPath, ['pr', 'view', String(number), '--json', 'files'])
  // Returning [] here made the review banner assert "#42 — 0 files": a
  // confident claim that the PR changes nothing (#24).
  if (res.code !== 0) return { ok: false, reason: listFailureReason(res) }
  return { ok: true, files: parsePrFiles(res.stdout) }
}

function fail(res: GhResult, fallback: string): OpResult {
  const message = res.missing ? GH_MISSING : res.stderr.trim() || fallback
  return { ok: false, code: 'unknown', message }
}

export async function checkoutPr(repoPath: string, number: number): Promise<OpResult> {
  const res = await runGh(repoPath, ['pr', 'checkout', String(number)])
  return res.code === 0 ? { ok: true } : fail(res, 'Could not check out the pull request.')
}

/** Create a PR for the current branch. Requires the branch to be pushed. */
export async function createPr(
  repoPath: string,
  base: string,
  title: string,
  body: string
): Promise<OpResult> {
  const args = ['pr', 'create', '--title', title, '--body', body]
  if (base) args.push('--base', base)
  const res = await runGh(repoPath, args)
  return res.code === 0 ? { ok: true } : fail(res, 'Could not create the pull request.')
}

export const githubProvider: HostProvider = {
  kind: 'github',
  status: ghStatus,
  listPullRequests,
  currentBranchPr,
  pullRequestFiles,
  checkoutPr,
  createPr
}
