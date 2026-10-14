import { lstat, realpath } from 'fs/promises'
import { join } from 'path'
import type {
  RehearsalApplyRequest,
  RehearsalApplyResult,
  RehearsalReport,
  RehearsalRecovery
} from '../shared/types'
import { commonRepository, withRepositoryWrite } from './repositoryQueue'
import { rehearsalAvailability, rehearsalShow, runRehearsalTool } from './rehearsal'
import { rehearsalReviewRevisionLocked } from './rehearsalReview'

const unknown = (repository: string, message: string): RehearsalRecovery => ({
  repository,
  state: 'unknown',
  can_complete: false,
  can_rollback: false,
  message: `Repository writes are blocked. ${message}`
})
const clear = (repository: string): RehearsalRecovery => ({
  repository,
  state: 'none',
  can_complete: false,
  can_rollback: false,
  message: 'No interrupted operation requires recovery.'
})
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exactId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)

/** Check only journal presence, never interpret metadata. The CLI's OS lock file
 * persists even after successful recovery, so its mere existence proves nothing. */
async function hasRecoveryFiles(repo: string): Promise<boolean> {
  const common = await commonRepository(repo)
  try {
    await lstat(join(common, 'rehearse-apply'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

export async function inspectRecovery(
  tool: string | undefined,
  repo: string
): Promise<RehearsalRecovery> {
  try {
    if (!tool)
      return (await hasRecoveryFiles(repo))
        ? unknown(
            repo,
            'Configure the compatible Rehearse tool to inspect the interrupted operation.'
          )
        : clear(repo)
    const availability = await rehearsalAvailability(tool)
    if (!availability.available)
      return (await hasRecoveryFiles(repo)) ? unknown(repo, availability.message) : clear(repo)
    const result = await runRehearsalTool(tool, ['--json', 'recover'], repo)
    const value: unknown = JSON.parse(result.stdout)
    if (
      object(value) &&
      ['refused', 'internal'].includes(String(value.kind)) &&
      typeof value.message === 'string'
    )
      return unknown(repo, value.message)
    if (
      !object(value) ||
      result.code !== 0 ||
      value.schema !== 1 ||
      value.action !== 'inspect' ||
      typeof value.repository !== 'string' ||
      (await realpath(value.repository)) !== (await realpath(repo)) ||
      ![
        'none',
        'before_ref_change',
        'after_ref_change',
        'complete',
        'rolling_back',
        'ambiguous'
      ].includes(String(value.state)) ||
      typeof value.can_complete !== 'boolean' ||
      typeof value.can_rollback !== 'boolean' ||
      (value.state !== 'none' &&
        (!exactId(value.rehearsal) || !['apply', 'undo'].includes(String(value.operation))))
    )
      return unknown(repo, 'Incompatible recovery response. Retained data has been preserved.')
    if (value.state === 'none') {
      if (value.can_complete || value.can_rollback || value.rehearsal !== undefined)
        return unknown(repo, 'Inconsistent recovery response.')
      return clear(repo)
    }
    return {
      repository: repo,
      state: value.state as RehearsalRecovery['state'],
      rehearsal: value.rehearsal as string,
      operation: value.operation as 'apply' | 'undo',
      can_complete: value.state !== 'ambiguous' && value.can_complete,
      can_rollback: value.state !== 'ambiguous' && value.can_rollback,
      message: `Interrupted ${value.operation}: ${value.state}. Repository writes are blocked until recovery is resolved.`
    }
  } catch (error) {
    return unknown(
      repo,
      error instanceof Error ? error.message : 'Recovery status could not be established.'
    )
  }
}

export async function applyRehearsal(
  tool: string | undefined,
  request: RehearsalApplyRequest
): Promise<RehearsalApplyResult> {
  const identity = request?.report
  const repo = identity?.origin_worktree
  try {
    return await withRepositoryWrite(repo, async () => {
      const recovery = await inspectRecovery(tool, repo)
      if (recovery.state !== 'none') return { kind: 'refused', message: recovery.message, recovery }
      if (!tool || !request?.expectedResultRevision) {
        return {
          kind: 'refused',
          message:
            'This git-rehearse version cannot apply a confirmed result revision. Update the compatible tool, then refresh and review the retained result.',
          recovery
        }
      }
      // Bind the exact ID to its origin immediately before asking the CLI to revalidate Apply.
      const shown = await rehearsalShow(tool, identity)
      if (
        shown.kind !== 'report' ||
        shown.report.can_apply !== true ||
        shown.report.outcome !== 'clean'
      )
        return {
          kind: 'refused',
          message:
            shown.kind === 'report' ? 'This retained result cannot be applied.' : shown.message,
          recovery
        }
      const reviewed = (report: RehearsalReport): string =>
        JSON.stringify([
          report.command,
          report.checkout,
          report.refs,
          report.drift,
          report.carried,
          report.outcome,
          report.conflicts,
          report.drift_unexpected
        ])
      if (reviewed(identity) !== reviewed(shown.report))
        return {
          kind: 'refused',
          message:
            'The retained result changed since review. Keep it and review it again before Apply.',
          recovery
        }
      if (
        shown.report.result_revision !== request.expectedResultRevision ||
        !shown.report.result_endpoints
      )
        return {
          kind: 'refused',
          message:
            shown.report.result_unavailable ||
            'The retained tool cannot prove the exact reviewed result. Keep it and refresh with a compatible git-rehearse release.',
          recovery
        }
      let currentReviewRevision: string
      try {
        currentReviewRevision = await rehearsalReviewRevisionLocked(tool, identity)
      } catch (error) {
        return {
          kind: 'refused',
          message:
            error instanceof Error
              ? `The reviewed result changed or became unavailable. Refresh the review before Apply. ${error.message}`
              : 'The reviewed result changed or became unavailable. Refresh the review before Apply.',
          recovery
        }
      }
      if (currentReviewRevision !== request.reviewRevision)
        return {
          kind: 'refused',
          message:
            'The displayed review changed. Refresh and confirm the current result before Apply.',
          recovery
        }
      let kind: RehearsalApplyResult['kind'] = 'uncertain'
      let message =
        'The Apply response was lost or incomplete. Status was queried; Apply was not repeated. Review the repository before starting another rehearsal.'
      try {
        const result = await runRehearsalTool(
          tool,
          [
            '--json',
            'apply',
            identity.id,
            '--expected-result-revision',
            request.expectedResultRevision
          ],
          repo
        )
        const value: unknown = JSON.parse(result.stdout)
        if (
          object(value) &&
          value.schema === 1 &&
          result.code === 0 &&
          value.exit_code === 0 &&
          value.id === identity.id &&
          value.repository === shown.report.repository &&
          value.result_revision === request.expectedResultRevision &&
          JSON.stringify(value.result_endpoints) ===
            JSON.stringify(shown.report.result_endpoints) &&
          object(value.applied) &&
          Array.isArray(value.applied.refs)
        ) {
          kind = 'applied'
          message = 'The checked rehearsal was applied.'
        } else if (
          object(value) &&
          value.schema === 1 &&
          value.kind === 'refused' &&
          typeof value.message === 'string'
        ) {
          kind = 'refused'
          message = `Apply refused — the result may be stale. ${value.message} The sandbox is retained.`
        }
      } catch {
        /* Unknown completion must be inspected, never retried. */
      }
      return { kind, message, recovery: await inspectRecovery(tool, repo) }
    })
  } catch (error) {
    return {
      kind: 'refused',
      message: String(error),
      recovery: unknown(repo ?? '', 'Could not establish repository ownership.')
    }
  }
}

export async function recoverRehearsal(
  tool: string | undefined,
  repo: string,
  id: string,
  action: 'complete' | 'rollback'
): Promise<RehearsalRecovery> {
  try {
    return await withRepositoryWrite(repo, async () => {
      const before = await inspectRecovery(tool, repo)
      if (
        !tool ||
        !exactId(id) ||
        before.rehearsal !== id ||
        !(action === 'complete'
          ? before.can_complete
          : action === 'rollback' && before.can_rollback)
      )
        return { ...before, message: `Recovery action refused. ${before.message}` }
      let detail = ''
      try {
        const result = await runRehearsalTool(tool, ['--json', 'recover', `--${action}`, id], repo)
        const value: unknown = JSON.parse(result.stdout)
        if (object(value) && typeof value.message === 'string') detail = value.message
      } catch {
        detail = 'Recovery response was lost. Status was queried without repeating the action.'
      }
      const after = await inspectRecovery(tool, repo)
      return { ...after, message: detail ? `${detail} ${after.message}` : after.message }
    })
  } catch (error) {
    return unknown(repo, String(error))
  }
}
