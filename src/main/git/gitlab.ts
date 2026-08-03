import { spawn } from 'child_process'
import { runGitResult, searchPath } from './exec'
import type {
  HostAuth,
  OpResult,
  PrFileChange,
  PrFilesResult,
  PrListResult,
  PullRequestInfo
} from '../../shared/types'
import { classifyCliFailure, CLI_TIMEOUT_MS, firstLine, TIMED_OUT } from './cliFailure'
import type { HostProvider } from './host'
import { hostnameOf } from './hostUrl'

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
        // Finder-launched apps do not see Homebrew's bin — see exec.ts
        PATH: searchPath(),
        GLAB_CHECK_UPDATE: '0',
        GIT_TERMINAL_PROMPT: '0',
        NO_COLOR: '1',
        NO_PROMPT: '1'
      }
    })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r: GlabResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    // No limit here meant a glab call behind a dead VPN hung the panel forever,
    // with the retry button greyed out by the stuck loading state (#24).
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
 *
 * The payload starts at the first `@@` hunk and carries no file headers, but we
 * skip them anyway in case that changes. Matching the path that follows matters:
 * a bare `startsWith('---')` also swallows a *removed* line whose own text
 * begins with `--` (a SQL comment, a flag in a shell snippet), which renders as
 * `---` + the text and would go uncounted. Exported for tests.
 */
const FILE_HEADER = /^(?:--- (?:a\/|\/dev\/null)|\+\+\+ (?:b\/|\/dev\/null))/

export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (FILE_HEADER.test(line)) continue
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

const MISSING =
  "GitLab CLI (glab) not found. If it is installed, Git City cannot see it on this app's PATH."

async function currentBranch(repoPath: string): Promise<string> {
  const res = await runGitResult(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return res.code === 0 ? res.stdout.trim() : ''
}

/** Wording for "the CLI was there but could not reach the server". */
function unreachable(failure: 'timeout' | 'offline'): { reason: string; hint: HostAuth['hint'] } {
  return {
    reason:
      failure === 'timeout'
        ? `GitLab didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
        : "Can't reach GitLab — check your network connection, then ↻.",
    hint: 'retry'
  }
}

async function status(repoPath: string, origin = ''): Promise<HostAuth> {
  const auth = await runGlab(repoPath, ['auth', 'status'])
  if (auth.missing) {
    return {
      host: 'gitlab',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason: MISSING,
      hint: 'install'
    }
  }
  if (auth.code !== 0) {
    // Being offline is not being logged out, and sending someone to re-auth a
    // working token because their wifi is off is a dead end (#24).
    const failure = classifyCliFailure(auth.stderr + auth.stdout)
    const base = {
      host: 'gitlab',
      available: true,
      authed: false,
      isRepo: false,
      login: null
    } as const
    return failure !== 'other'
      ? { ...base, ...unreachable(failure) }
      : { ...base, reason: 'Not logged in to GitLab — run: glab auth login', hint: 'login' }
  }
  const project = await runGlab(repoPath, ['api', 'projects/:fullpath'])
  if (project.code !== 0) {
    return {
      host: 'gitlab',
      available: true,
      authed: true,
      isRepo: false,
      login: null,
      ...projectFailure(project, origin)
    }
  }
  let login: string | null = null
  const me = await runGlab(repoPath, ['api', 'user'])
  if (me.code === 0) {
    try {
      login = (JSON.parse(me.stdout) as { username?: string }).username ?? null
    } catch {
      login = null
    }
  }
  return { host: 'gitlab', available: true, authed: true, isRepo: true, login, reason: null }
}

/** Why the project lookup failed — mirrors gh's repoViewFailure (#24). */
function projectFailure(
  project: GlabResult,
  origin: string
): { reason: string; hint: HostAuth['hint'] } {
  const output = project.stderr + project.stdout
  const failure = classifyCliFailure(output)
  if (failure !== 'other') return unreachable(failure)
  if (/401|unauthorized|not authenticated|glab auth login/i.test(output)) {
    const host = hostnameOf(origin)
    return {
      reason: host
        ? `glab is not logged in to ${host} — run: glab auth login --hostname ${host}`
        : 'glab is not logged in to this host — run: glab auth login',
      hint: 'login'
    }
  }
  if (/404|not found|no such remote|could not determine/i.test(output)) {
    return { reason: 'This repository has no GitLab remote.', hint: 'none' }
  }
  const detail = firstLine(output)
  return {
    reason: detail
      ? `glab could not read this project (${detail})`
      : 'glab could not read this project.',
    hint: 'retry'
  }
}

function listFailureReason(res: GlabResult): string {
  if (res.missing) return MISSING
  const failure = classifyCliFailure(res.stderr + res.stdout)
  if (failure === 'timeout') {
    return `glab didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
  }
  if (failure === 'offline') return "Couldn't reach GitLab — check your network, then ↻."
  const detail = firstLine(res.stderr + res.stdout)
  return detail ? `Couldn't reach GitLab: ${detail} Try ↻.` : "Couldn't reach GitLab. Try ↻."
}

/** Ask for one more than we show, so a capped list can say it is capped (#24). */
const MR_PAGE = 50

async function listPullRequests(repoPath: string): Promise<PrListResult> {
  const res = await runGlab(repoPath, [
    'api',
    `projects/:fullpath/merge_requests?state=opened&per_page=${MR_PAGE + 1}`
  ])
  // [] used to mean both "none open" and "the call failed", so a rate limit
  // rendered as "No open merge requests" for a project with forty (#24).
  if (res.code !== 0) return { ok: false, reason: listFailureReason(res) }
  const all = parseMrList(res.stdout)
  return { ok: true, prs: all.slice(0, MR_PAGE), more: all.length > MR_PAGE }
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

async function pullRequestFiles(repoPath: string, number: number): Promise<PrFilesResult> {
  const res = await runGlab(repoPath, [
    'api',
    `projects/:fullpath/merge_requests/${number}/changes`
  ])
  // Returning [] here made the review banner assert "0 files" — a confident
  // claim that the MR changes nothing (#24).
  if (res.code !== 0) return { ok: false, reason: listFailureReason(res) }
  return { ok: true, files: parseMrChanges(res.stdout) }
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
