import { rehearsalComparisonKey } from '../shared/rehearsalComparison'
import { realpath } from 'fs/promises'
import { isAbsolute, relative, sep } from 'path'
import type {
  RehearsalComparison,
  RehearsalIdentity,
  RehearsalReport,
  RehearsalResultEndpoints
} from '../shared/types'
import { analyzeComparison } from './git/analyze'
import { runGit } from './git/exec'
import { rehearsalShow } from './rehearsal'
import { withRehearsal } from './rehearsalConflicts'

const sha = (value: string | undefined): string => {
  if (!value || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))
    throw new Error('Frozen comparison commit is unavailable. Refresh the rehearsal.')
  return value
}
const inside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

/**
 * Resolve the exact immutable commits retained by a rehearsal. Both the city
 * comparison and the text review call this function; neither is allowed to
 * infer an endpoint from the live checkout or a renderer supplied path.
 */
export async function resolveRehearsalEndpoints(report: RehearsalReport): Promise<string[]> {
  const root = await realpath(report.sandbox ?? '')
  const origin = await realpath(report.origin_worktree)
  if (!report.sandbox || inside(root, origin) || inside(origin, root))
    throw new Error('Comparison requires a separate retained sandbox.')
  for (const option of ['--absolute-git-dir', '--git-common-dir']) {
    const directory = await realpath(
      (await runGit(root, ['rev-parse', '--path-format=absolute', option])).trim()
    )
    if (!inside(root, directory)) throw new Error('Sandbox Git metadata must be isolated.')
  }
  const complete = report.outcome === 'clean' && !report.conflicted && report.conflicts.length === 0
  const endpoints = report.result_endpoints
  const resultRevision = report.result_revision
  if (!complete) {
    const before = report.pre_state.HEAD
    if (!before)
      throw new Error('Frozen comparison Before endpoint is unavailable. Refresh the rehearsal.')
    return [sha(before)]
  }
  if (!endpoints || !resultRevision) {
    throw new Error(
      report.result_unavailable ||
        'This retained result has no authoritative endpoints. Refresh with a compatible git-rehearse release.'
    )
  }
  await validateResultEndpoints(report, endpoints, resultRevision)
  const beforeHead = sha(endpoints.pre_state.HEAD)
  const afterHead = sha(endpoints.results.HEAD)
  if (!endpoints.carried) return [beforeHead, afterHead]
  const carried = endpoints.carried
  if (
    carried.snapshot_ref_status !== 'present' ||
    !carried.snapshot_ref ||
    sha(carried.snapshot_ref) !== sha(carried.snapshot)
  )
    throw new Error(
      `The authoritative carried-work snapshot is unavailable (${carried.snapshot_ref_status}; ${carried.snapshot_ref ?? 'no ref'}; ${carried.snapshot}). Refresh the result.`
    )
  const before = sha(carried.snapshot)
  await requireFirstParent(
    root,
    before,
    sha(endpoints.pre_state.HEAD),
    'The authoritative carried-work snapshot does not match this rehearsal.'
  )
  if (report.carried?.status === 'restored') {
    if (
      carried.replay_ref_status !== 'present' ||
      !carried.replay_ref ||
      !carried.replay ||
      sha(carried.replay_ref) !== sha(carried.replay)
    )
      throw new Error('The authoritative carried-work replay is unavailable. Refresh the result.')
    await requireFirstParent(
      root,
      sha(carried.replay),
      afterHead,
      'The authoritative carried-work replay does not match this rehearsal.'
    )
    return [before, sha(carried.replay)]
  }
  if (
    report.carried?.status === 'contained' &&
    carried.replay_ref_status === 'not_produced' &&
    carried.replay === null &&
    carried.replay_ref === null
  )
    return [before, afterHead]
  if (
    report.carried?.status === 'not_needed' &&
    carried.replay_ref_status === 'not_needed' &&
    carried.replay === null &&
    carried.replay_ref === null
  )
    return [before, before]
  throw new Error(
    'The retained carried-work endpoints are unavailable for review. Refresh with a compatible git-rehearse release.'
  )
}

async function requireFirstParent(
  sandbox: string,
  commit: string,
  expectedParent: string,
  message: string
): Promise<void> {
  const parent = sha(
    (await runGit(sandbox, ['--no-replace-objects', 'rev-parse', '--verify', `${commit}^1`])).trim()
  )
  if (parent !== expectedParent) throw new Error(`${message} Refresh the result.`)
}

async function validateResultEndpoints(
  report: RehearsalReport,
  endpoints: RehearsalResultEndpoints,
  revision: string
): Promise<void> {
  if (!/^rr1:(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision) || endpoints.version !== 1)
    throw new Error('The retained result revision is invalid. Refresh the rehearsal.')
  if (
    endpoints.origin.rehearsal !== report.id ||
    endpoints.origin.repository !== report.repository ||
    endpoints.origin.repository_id !== report.repository_id ||
    JSON.stringify(endpoints.action) !== JSON.stringify(report.command) ||
    JSON.stringify(endpoints.checkout) !== JSON.stringify(report.checkout)
  )
    throw new Error('The authoritative retained endpoints do not match this rehearsal.')
  const origin = await realpath(report.origin_worktree)
  if ((await realpath(endpoints.origin.repository)) !== origin)
    throw new Error('The authoritative endpoints belong to another original worktree.')
  const actualGitDir = await realpath(
    (await runGit(origin, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'])).trim()
  )
  const actualCommonDir = await realpath(
    (await runGit(origin, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  )
  if (
    (await realpath(endpoints.origin.git_dir)) !== actualGitDir ||
    (await realpath(endpoints.origin.common_dir)) !== actualCommonDir
  )
    throw new Error('The authoritative endpoint repository identity changed. Refresh the result.')
  if (sha(endpoints.pre_state.HEAD) !== sha(report.pre_state.HEAD))
    throw new Error('The authoritative Before endpoint does not match the retained report.')
  const reportHead = report.refs.find((ref) => ref.name === 'HEAD')?.after
  if (reportHead && sha(endpoints.results.HEAD) !== sha(reportHead))
    throw new Error('The authoritative After endpoint does not match the retained report.')
  if (report.carried && !endpoints.carried)
    throw new Error('The retained report has carried work without authoritative frozen endpoints.')
}

export async function compareRehearsal(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<RehearsalComparison> {
  return withRehearsal(identity, async () => {
    const read = async (): Promise<RehearsalReport> => {
      const result = await rehearsalShow(tool, identity)
      if (result.kind !== 'report') throw new Error(result.message)
      return result.report
    }
    const report = await read()
    const commits = await resolveRehearsalEndpoints(report)
    const analysis = await analyzeComparison(report.sandbox!, commits)
    // Other CLI processes don't share the app queue. Reject a changing result.
    const current = await read()
    if (
      rehearsalComparisonKey(current) !== rehearsalComparisonKey(report) ||
      JSON.stringify(await resolveRehearsalEndpoints(current)) !== JSON.stringify(commits)
    )
      throw new Error('Rehearsal changed during analysis. Refresh the comparison.')
    return {
      reportKey: rehearsalComparisonKey(report),
      identity: {
        id: report.id,
        repository: report.repository,
        repository_id: report.repository_id,
        origin_worktree: report.origin_worktree
      },
      analysis,
      afterAvailable: commits.length === 2,
      notice:
        commits.length === 2
          ? 'Frozen rehearsal endpoints, including tracked carried work. Untracked files are excluded.'
          : '⚠ No finished After endpoint is available. Before shows only the frozen committed tree; tracked carried work is unavailable because the tool did not publish an authoritative snapshot.'
    }
  })
}
