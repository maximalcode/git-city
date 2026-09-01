import type {
  HostAuth,
  OpResult,
  PrFileChange,
  PrFilesResult,
  PrListResult,
  PullRequestInfo
} from '../../shared/types'
import {
  classifyCliFailure,
  listFailureReason,
  opFailure,
  repoProbeFailure,
  unreachable
} from './cliFailure'
import type { CliWording, RepoProbeWording } from './cliFailure'
import { cliRunner } from './cliRunner'
import type { CliRunner } from './cliRunner'
import type { HostProvider } from './host'

/**
 * GitHub integration via the `gh` CLI — zero extra auth setup: gh already holds
 * the user's token in the OS keychain, so we shell out and never handle a token
 * ourselves. Non-GitHub repos (or a missing/logged-out gh) degrade to a clear
 * "unavailable" reason rather than an error.
 *
 * Everything that is not gh's own JSON shapes or gh's own wording — spawn,
 * PATH repair, the timeout, ENOENT, failure classification, and the failure
 * sentences — lives in `cliRunner.ts` / `cliFailure.ts` (#109).
 */

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

/** gh's own names and phrasings, for the shared failure wording (#109). */
const GH_WORDING: CliWording = { missing: GH_MISSING, cli: 'gh', subject: 'GitHub' }

const GH_PROBE: RepoProbeWording = {
  ...GH_WORDING,
  noun: 'repository',
  // how gh phrases "not authenticated here" / "no such repo" on a repo view
  authPattern: /not logged (in )?to|authentication|gh auth login|HTTP 401/i,
  notFoundPattern: /no such remote|not a git repository|could not determine|no git remotes/i
}

/** The real gh runner: binary name + gh's env keys are the only variation. */
const runGh: CliRunner = cliRunner({ binary: 'gh', env: { GH_PAGER: '', GH_PROMPT_DISABLED: '1' } })

/**
 * Ask for one more than we show, so a capped list can say it is capped rather
 * than presenting the first 50 as the whole truth (#24).
 */
const PR_PAGE = 50

/** Build the GitHub provider over any {@link CliRunner} — the injection seam (#109). */
export function createGithubProvider(run: CliRunner): HostProvider {
  /** gh availability + auth + whether this repo is a GitHub repo. */
  async function status(repoPath: string, origin = ''): Promise<HostAuth> {
    const auth = await run(repoPath, ['auth', 'status'])
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
          ...unreachable('GitHub', failure)
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
    const repo = await run(repoPath, ['repo', 'view', '--json', 'nameWithOwner'])
    if (repo.code === 0) {
      return { host: 'github', available: true, authed: true, isRepo: true, login, reason: null }
    }
    return {
      host: 'github',
      available: true,
      authed: true,
      isRepo: false,
      login,
      ...repoProbeFailure(repo, origin, GH_PROBE)
    }
  }

  async function listPullRequests(repoPath: string): Promise<PrListResult> {
    const res = await run(repoPath, [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      String(PR_PAGE + 1),
      '--json',
      PR_FIELDS
    ])
    if (res.code !== 0) return { ok: false, reason: listFailureReason(res, GH_WORDING) }
    try {
      const all = (JSON.parse(res.stdout) as RawPr[]).map(mapPr)
      return { ok: true, prs: all.slice(0, PR_PAGE), more: all.length > PR_PAGE }
    } catch {
      return { ok: false, reason: "Couldn't read the response from gh. Try ↻." }
    }
  }

  /** The open PR whose head is the current branch, or null. */
  async function currentBranchPr(repoPath: string): Promise<PullRequestInfo | null> {
    const res = await run(repoPath, ['pr', 'view', '--json', PR_FIELDS])
    if (res.code !== 0) return null
    try {
      const p = JSON.parse(res.stdout) as RawPr
      if (p.state && p.state !== 'OPEN') return null
      return mapPr(p)
    } catch {
      return null
    }
  }

  /** The files a PR changes, for lighting them up in the scene. */
  async function pullRequestFiles(repoPath: string, number: number): Promise<PrFilesResult> {
    const res = await run(repoPath, ['pr', 'view', String(number), '--json', 'files'])
    // Returning [] here made the review banner assert "#42 — 0 files": a
    // confident claim that the PR changes nothing (#24).
    if (res.code !== 0) return { ok: false, reason: listFailureReason(res, GH_WORDING) }
    return { ok: true, files: parsePrFiles(res.stdout) }
  }

  async function checkoutPr(repoPath: string, number: number): Promise<OpResult> {
    const res = await run(repoPath, ['pr', 'checkout', String(number)])
    return res.code === 0
      ? { ok: true }
      : opFailure(res, GH_MISSING, 'Could not check out the pull request.')
  }

  /** Create a PR for the current branch. Requires the branch to be pushed. */
  async function createPr(
    repoPath: string,
    base: string,
    title: string,
    body: string
  ): Promise<OpResult> {
    const args = ['pr', 'create', '--title', title, '--body', body]
    if (base) args.push('--base', base)
    const res = await run(repoPath, args)
    return res.code === 0
      ? { ok: true }
      : opFailure(res, GH_MISSING, 'Could not create the pull request.')
  }

  return {
    kind: 'github',
    status,
    listPullRequests,
    currentBranchPr,
    pullRequestFiles,
    checkoutPr,
    createPr
  }
}

export const githubProvider: HostProvider = createGithubProvider(runGh)

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
