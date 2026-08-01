import { spawn } from 'child_process'
import type { HostAuth, OpResult, PrFileChange, PullRequestInfo } from '../../shared/types'
import type { HostProvider } from './host'

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
        GH_PAGER: '',
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
        NO_COLOR: '1'
      }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) =>
      resolve({
        code: -1,
        stdout,
        stderr: String(err),
        missing: (err as NodeJS.ErrnoException).code === 'ENOENT'
      })
    )
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr, missing: false }))
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

/** gh availability + auth + whether this repo is a GitHub repo. */
export async function ghStatus(repoPath: string): Promise<HostAuth> {
  const auth = await runGh(repoPath, ['auth', 'status'])
  if (auth.missing) {
    return {
      host: 'github',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason: 'GitHub CLI (gh) is not installed.'
    }
  }
  if (auth.code !== 0) {
    return {
      host: 'github',
      available: true,
      authed: false,
      isRepo: false,
      login: null,
      reason: 'Not logged in to GitHub — run: gh auth login'
    }
  }
  const login = /account (\S+)/.exec(auth.stderr + auth.stdout)?.[1] ?? null
  const repo = await runGh(repoPath, ['repo', 'view', '--json', 'nameWithOwner'])
  const isRepo = repo.code === 0
  return {
    host: 'github',
    available: true,
    authed: true,
    isRepo,
    login,
    reason: isRepo ? null : 'This repository has no GitHub remote.'
  }
}

export async function listPullRequests(repoPath: string): Promise<PullRequestInfo[]> {
  const res = await runGh(repoPath, [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    PR_FIELDS
  ])
  if (res.code !== 0) return []
  try {
    return (JSON.parse(res.stdout) as RawPr[]).map(mapPr)
  } catch {
    return []
  }
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

/** The files a PR changes, for lighting them up in the city/forest. */
export async function pullRequestFiles(repoPath: string, number: number): Promise<PrFileChange[]> {
  const res = await runGh(repoPath, ['pr', 'view', String(number), '--json', 'files'])
  if (res.code !== 0) return []
  return parsePrFiles(res.stdout)
}

function fail(res: GhResult, fallback: string): OpResult {
  const message = res.missing ? 'GitHub CLI (gh) is not installed.' : res.stderr.trim() || fallback
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
