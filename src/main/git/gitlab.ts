import { spawn } from 'child_process'
import { runGitResult } from './exec'
import type { HostAuth, OpResult, PrFileChange, PullRequestInfo } from '../../shared/types'
import type { HostProvider } from './host'

/**
 * GitLab integration via the `glab` CLI — the same bargain we strike with `gh`:
 * glab already holds the user's token, so we shell out and never handle one.
 *
 * Reads go through `glab api`, not `glab mr list`, because the REST payload has
 * stable documented field names while the CLI's own JSON is a presentation
 * format. Writes use the porcelain (`mr checkout`, `mr create`), which is what
 * it is good at.
 *
 * Merge requests are mapped onto PullRequestInfo so the renderer keeps one
 * vocabulary; only the panel's wording changes.
 */

interface GlabResult {
  code: number
  stdout: string
  stderr: string
  /** glab binary not found on PATH */
  missing: boolean
}

function runGlab(cwd: string, args: string[]): Promise<GlabResult> {
  return new Promise((resolve) => {
    const child = spawn('glab', args, {
      cwd,
      env: {
        ...process.env,
        GLAB_CHECK_UPDATE: '0',
        GIT_TERMINAL_PROMPT: '0',
        NO_COLOR: '1',
        NO_PROMPT: '1'
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

/**
 * Collapse a GitLab pipeline status into the same four states the city already
 * understands. Exported for tests.
 *
 * `manual` means a gate is waiting for a human, not that anything broke, so it
 * reads as pending. An unrecognised status also reads as pending: if GitLab
 * adds one, "something is happening" is a safer default than claiming success.
 */
export function deriveCi(pipeline: unknown): PullRequestInfo['ci'] {
  const status = String((pipeline as { status?: unknown } | null)?.status ?? '').toLowerCase()
  if (!status) return 'none'
  if (status === 'success') return 'passing'
  if (['failed', 'canceled', 'cancelled'].includes(status)) return 'failing'
  if (status === 'skipped') return 'none'
  return 'pending'
}

interface RawMr {
  iid?: number
  title?: string
  source_branch?: string
  target_branch?: string
  state?: string
  draft?: boolean
  work_in_progress?: boolean
  web_url?: string
  author?: { username?: string }
  head_pipeline?: unknown
  pipeline?: unknown
}

/** Map one GitLab merge request onto the shared PR model. Exported for tests. */
export function mapMr(mr: RawMr): PullRequestInfo {
  return {
    number: mr.iid ?? 0,
    title: mr.title ?? '',
    headRef: mr.source_branch ?? '',
    baseRef: mr.target_branch ?? '',
    state:
      (mr.state ?? 'opened').toUpperCase() === 'OPENED' ? 'OPEN' : (mr.state ?? '').toUpperCase(),
    isDraft: !!(mr.draft ?? mr.work_in_progress),
    url: mr.web_url ?? '',
    author: mr.author?.username ?? '',
    // the list endpoint may omit head_pipeline; `pipeline` is the older name
    ci: deriveCi(mr.head_pipeline ?? mr.pipeline)
  }
}

/** Parse an array of merge requests. Exported for tests. */
export function parseMrList(stdout: string): PullRequestInfo[] {
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed)) return []
    return (parsed as RawMr[]).filter((m) => typeof m.iid === 'number').map(mapMr)
  } catch {
    return []
  }
}

/**
 * Count added/removed lines in a unified diff. GitLab's changes endpoint ships
 * the diff text but no per-file counts, unlike GitHub — so we count them here.
 * `+++`/`---` are the file headers, not content. Exported for tests.
 */
export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

interface RawChange {
  new_path?: string
  old_path?: string
  diff?: string
}

/** Map the changes endpoint onto changed-file records. Exported for tests. */
export function parseMrChanges(stdout: string): PrFileChange[] {
  try {
    const parsed = JSON.parse(stdout) as { changes?: RawChange[] }
    const changes = Array.isArray(parsed.changes) ? parsed.changes : []
    return changes
      .map((c) => ({ path: c.new_path || c.old_path || '', diff: c.diff ?? '' }))
      .filter((c) => c.path.length > 0)
      .map((c) => ({ path: c.path, ...countDiffLines(c.diff) }))
  } catch {
    return []
  }
}

const MISSING = 'GitLab CLI (glab) is not installed.'

async function currentBranch(repoPath: string): Promise<string> {
  const res = await runGitResult(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return res.code === 0 ? res.stdout.trim() : ''
}

async function status(repoPath: string): Promise<HostAuth> {
  const auth = await runGlab(repoPath, ['auth', 'status'])
  if (auth.missing) {
    return {
      host: 'gitlab',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason: MISSING
    }
  }
  if (auth.code !== 0) {
    return {
      host: 'gitlab',
      available: true,
      authed: false,
      isRepo: false,
      login: null,
      reason: 'Not logged in to GitLab — run: glab auth login'
    }
  }
  const project = await runGlab(repoPath, ['api', 'projects/:fullpath'])
  const isRepo = project.code === 0
  let login: string | null = null
  if (isRepo) {
    const me = await runGlab(repoPath, ['api', 'user'])
    if (me.code === 0) {
      try {
        login = (JSON.parse(me.stdout) as { username?: string }).username ?? null
      } catch {
        login = null
      }
    }
  }
  return {
    host: 'gitlab',
    available: true,
    authed: true,
    isRepo,
    login,
    reason: isRepo ? null : 'This repository has no GitLab remote.'
  }
}

async function listPullRequests(repoPath: string): Promise<PullRequestInfo[]> {
  const res = await runGlab(repoPath, [
    'api',
    'projects/:fullpath/merge_requests?state=opened&per_page=50'
  ])
  return res.code === 0 ? parseMrList(res.stdout) : []
}

/**
 * The open MR whose source branch is the current one.
 *
 * Fetched by iid rather than reused from the list, because the single-MR
 * endpoint is the one that reliably carries `head_pipeline` — and this is the
 * MR whose CI state the HUD puts front and centre.
 */
async function currentBranchPr(repoPath: string): Promise<PullRequestInfo | null> {
  const branch = await currentBranch(repoPath)
  if (!branch || branch === 'HEAD') return null
  const res = await runGlab(repoPath, [
    'api',
    `projects/:fullpath/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`
  ])
  if (res.code !== 0) return null
  const [mr] = parseMrList(res.stdout)
  if (!mr) return null
  const detail = await runGlab(repoPath, ['api', `projects/:fullpath/merge_requests/${mr.number}`])
  if (detail.code !== 0) return mr
  try {
    return mapMr(JSON.parse(detail.stdout) as RawMr)
  } catch {
    return mr
  }
}

async function pullRequestFiles(repoPath: string, number: number): Promise<PrFileChange[]> {
  const res = await runGlab(repoPath, [
    'api',
    `projects/:fullpath/merge_requests/${number}/changes`
  ])
  return res.code === 0 ? parseMrChanges(res.stdout) : []
}

function fail(res: GlabResult, fallback: string): OpResult {
  const message = res.missing ? MISSING : res.stderr.trim() || fallback
  return { ok: false, code: 'unknown', message }
}

async function checkoutPr(repoPath: string, number: number): Promise<OpResult> {
  const res = await runGlab(repoPath, ['mr', 'checkout', String(number)])
  return res.code === 0 ? { ok: true } : fail(res, 'Could not check out the merge request.')
}

async function createPr(
  repoPath: string,
  base: string,
  title: string,
  body: string
): Promise<OpResult> {
  const args = ['mr', 'create', '--title', title, '--description', body, '--yes']
  if (base) args.push('--target-branch', base)
  const res = await runGlab(repoPath, args)
  return res.code === 0 ? { ok: true } : fail(res, 'Could not create the merge request.')
}

export const gitlabProvider: HostProvider = {
  kind: 'gitlab',
  status,
  listPullRequests,
  currentBranchPr,
  pullRequestFiles,
  checkoutPr,
  createPr
}
