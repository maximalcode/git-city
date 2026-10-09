import { rehearsalComparisonKey } from '../shared/rehearsalComparison'
import { realpath } from 'fs/promises'
import { isAbsolute, relative, sep } from 'path'
import type { RehearsalComparison, RehearsalIdentity, RehearsalReport } from '../shared/types'
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
  const complete =
    report.outcome === 'clean' &&
    !report.conflicted &&
    report.conflicts.length === 0 &&
    (!report.carried ||
      (['restored', 'contained', 'not_needed'].includes(report.carried.status) &&
        report.carried.conflicts.length === 0))
  const beforeHead = sha(report.pre_state.HEAD)
  const movement = report.refs.find((ref) => ref.name === 'HEAD')
  const afterHead = complete && movement ? sha(movement.after) : beforeHead
  let before = beforeHead
  let after = afterHead
  if (report.carried) {
    // Compatibility adapter for the pinned tool's retained Git refs. Never read
    // private metadata or mutable working files; validate the stash ancestry.
    const snapshot = async (ref: string, parent: string): Promise<string> => {
      const commit = sha((await runGit(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim())
      if ((await runGit(root, ['rev-parse', `${commit}^1`])).trim() !== parent)
        throw new Error('Carried-work snapshot does not match this rehearsal. Refresh the report.')
      return commit
    }
    before = await snapshot('refs/rehearse/carried', beforeHead)
    if (complete && report.carried.status === 'restored')
      after = await snapshot('refs/rehearse/replayed', afterHead)
    else if (report.carried.status === 'not_needed') after = before
  }
  return complete ? [before, after] : [before]
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
          : '⚠ No finished After: this rehearsal is stopped, incomplete, failed, or has unresolved carried work. Continue and refresh to compare the completed result.' +
            (report.outcome === 'incomplete' && !report.carried
              ? ' Before shows the frozen committed tree only: this incomplete report has no carried-work details.'
              : '')
    }
  })
}
