import { runGitResult } from './exec'
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
 *
 * Everything that is not glab's own JSON shapes or glab's own wording — spawn,
 * PATH repair, the timeout, ENOENT, failure classification, and the failure
 * sentences — lives in `cliRunner.ts` / `cliFailure.ts` (#109).
 */

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

/** glab's own names and phrasings, for the shared failure wording (#109). */
const GL_WORDING: CliWording = { missing: MISSING, cli: 'glab', subject: 'GitLab' }

const GL_PROBE: RepoProbeWording = {
  ...GL_WORDING,
  noun: 'project',
  // glab reports HTTP status codes where gh phrases things in prose
  authPattern: /401|unauthorized|not authenticated|glab auth login/i,
  notFoundPattern: /404|not found|no such remote|could not determine/i
}

/** The real glab runner: binary name + glab's env keys are the only variation. */
const runGlab: CliRunner = cliRunner({
  binary: 'glab',
  env: { GLAB_CHECK_UPDATE: '0', NO_PROMPT: '1' }
})

async function currentBranch(repoPath: string): Promise<string> {
  const res = await runGitResult(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return res.code === 0 ? res.stdout.trim() : ''
}

/** Ask for one more than we show, so a capped list can say it is capped (#24). */
const MR_PAGE = 50

/** Build the GitLab provider over any {@link CliRunner} — the injection seam (#109). */
export function createGitlabProvider(run: CliRunner): HostProvider {
  async function status(repoPath: string, origin = ''): Promise<HostAuth> {
    const auth = await run(repoPath, ['auth', 'status'])
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
        ? { ...base, ...unreachable('GitLab', failure) }
        : { ...base, reason: 'Not logged in to GitLab — run: glab auth login', hint: 'login' }
    }
    const project = await run(repoPath, ['api', 'projects/:fullpath'])
    if (project.code !== 0) {
      return {
        host: 'gitlab',
        available: true,
        authed: true,
        isRepo: false,
        login: null,
        ...repoProbeFailure(project, origin, GL_PROBE)
      }
    }
    let login: string | null = null
    const me = await run(repoPath, ['api', 'user'])
    if (me.code === 0) {
      try {
        login = (JSON.parse(me.stdout) as { username?: string }).username ?? null
      } catch {
        login = null
      }
    }
    return { host: 'gitlab', available: true, authed: true, isRepo: true, login, reason: null }
  }

  async function listPullRequests(repoPath: string): Promise<PrListResult> {
    const res = await run(repoPath, [
      'api',
      `projects/:fullpath/merge_requests?state=opened&per_page=${MR_PAGE + 1}`
    ])
    // [] used to mean both "none open" and "the call failed", so a rate limit
    // rendered as "No open merge requests" for a project with forty (#24).
    if (res.code !== 0) return { ok: false, reason: listFailureReason(res, GL_WORDING) }
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
    const res = await run(repoPath, [
      'api',
      `projects/:fullpath/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`
    ])
    if (res.code !== 0) return null
    const [mr] = parseMrList(res.stdout)
    if (!mr) return null
    const detail = await run(repoPath, ['api', `projects/:fullpath/merge_requests/${mr.number}`])
    if (detail.code !== 0) return mr
    try {
      return mapMr(JSON.parse(detail.stdout) as RawMr)
    } catch {
      return mr
    }
  }

  async function pullRequestFiles(repoPath: string, number: number): Promise<PrFilesResult> {
    const res = await run(repoPath, ['api', `projects/:fullpath/merge_requests/${number}/changes`])
    // Returning [] here made the review banner assert "0 files" — a confident
    // claim that the MR changes nothing (#24).
    if (res.code !== 0) return { ok: false, reason: listFailureReason(res, GL_WORDING) }
    return { ok: true, files: parseMrChanges(res.stdout) }
  }

  async function checkoutPr(repoPath: string, number: number): Promise<OpResult> {
    const res = await run(repoPath, ['mr', 'checkout', String(number)])
    return res.code === 0
      ? { ok: true }
      : opFailure(res, MISSING, 'Could not check out the merge request.')
  }

  async function createPr(
    repoPath: string,
    base: string,
    title: string,
    body: string
  ): Promise<OpResult> {
    const args = ['mr', 'create', '--title', title, '--description', body, '--yes']
    if (base) args.push('--target-branch', base)
    const res = await run(repoPath, args)
    return res.code === 0
      ? { ok: true }
      : opFailure(res, MISSING, 'Could not create the merge request.')
  }

  return {
    kind: 'gitlab',
    status,
    listPullRequests,
    currentBranchPr,
    pullRequestFiles,
    checkoutPr,
    createPr
  }
}

export const gitlabProvider: HostProvider = createGitlabProvider(runGlab)
