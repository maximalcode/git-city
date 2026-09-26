import { realpath } from 'fs/promises'
import type { RehearsalUndoResult, RehearsalUndoStatus } from '../shared/types'
import { rehearsalAvailability, runRehearsalTool } from './rehearsal'
import { inspectRecovery, withRepositoryWrite } from './rehearsalRecovery'

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function inspectUndo(
  tool: string | undefined,
  repo: string
): Promise<RehearsalUndoStatus> {
  const unavailable = (reason: string): RehearsalUndoStatus => ({
    repository: repo,
    rehearsal: null,
    worktree: null,
    applied_at_unix: null,
    available: false,
    reason
  })
  try {
    const availability = await rehearsalAvailability(tool)
    if (!tool || !availability.available) return unavailable(availability.message)
    const result = await runRehearsalTool(tool, ['--json', 'undo', '--check'], repo)
    const value: unknown = JSON.parse(result.stdout)
    if (
      object(value) &&
      value.schema === 1 &&
      value.kind === 'refused' &&
      typeof value.message === 'string'
    )
      return unavailable(value.message)
    if (
      !object(value) ||
      value.schema !== 1 ||
      result.code !== 0 ||
      value.exit_code !== 0 ||
      typeof value.repository !== 'string' ||
      (await realpath(value.repository)) !== (await realpath(repo)) ||
      typeof value.available !== 'boolean' ||
      !(value.reason === null || typeof value.reason === 'string') ||
      !(
        value.rehearsal === null ||
        (typeof value.rehearsal === 'string' && /^[a-zA-Z0-9_-]+$/.test(value.rehearsal))
      ) ||
      !(value.worktree === null || typeof value.worktree === 'string') ||
      !(
        value.applied_at_unix === null ||
        (Number.isSafeInteger(value.applied_at_unix) && Number(value.applied_at_unix) >= 0)
      ) ||
      (value.available &&
        (!value.rehearsal ||
          !value.worktree ||
          value.applied_at_unix === null ||
          (await realpath(value.worktree as string)) !== (await realpath(repo))))
    )
      return unavailable(
        'Incompatible Undo status. Restore the compatible Rehearse tool; retained data is preserved.'
      )
    return {
      repository: repo,
      rehearsal: value.rehearsal as string | null,
      worktree: value.worktree as string | null,
      applied_at_unix: value.applied_at_unix as number | null,
      available: value.available,
      reason: value.reason as string | null
    }
  } catch (error) {
    return unavailable(`Could not inspect Undo availability: ${String(error)}`)
  }
}

export async function undoRehearsal(
  tool: string | undefined,
  repo: string,
  identity: RehearsalUndoStatus
): Promise<RehearsalUndoResult> {
  return withRepositoryWrite(repo, async () => {
    const recovery = await inspectRecovery(tool, repo)
    if (recovery.state !== 'none') return { kind: 'refused', message: recovery.message, recovery }
    const current = await inspectUndo(tool, repo)
    if (
      !tool ||
      !current.available ||
      !identity ||
      identity.repository !== repo ||
      identity.rehearsal !== current.rehearsal ||
      identity.worktree !== current.worktree ||
      identity.applied_at_unix !== current.applied_at_unix
    )
      return {
        kind: 'refused',
        message:
          current.reason ??
          'The exact Apply or original worktree changed. Refresh Undo availability.',
        recovery
      }
    let kind: RehearsalUndoResult['kind'] = 'uncertain'
    let message = 'Undo response was lost or incomplete. Status was queried; Undo was not repeated.'
    try {
      const result = await runRehearsalTool(tool, ['--json', 'undo', current.rehearsal!], repo)
      const value: unknown = JSON.parse(result.stdout)
      if (
        object(value) &&
        value.schema === 1 &&
        result.code === 0 &&
        value.exit_code === 0 &&
        value.rehearsal === current.rehearsal &&
        value.applied_at_unix === current.applied_at_unix &&
        typeof value.repository === 'string' &&
        (await realpath(value.repository)) === (await realpath(repo)) &&
        Array.isArray(value.restored)
      ) {
        kind = 'undone'
        message = `Undid Apply ${current.rehearsal} in ${current.worktree}.`
      } else if (
        object(value) &&
        value.schema === 1 &&
        value.kind === 'refused' &&
        typeof value.message === 'string'
      ) {
        kind = 'refused'
        message = `Undo refused. ${value.message}`
      }
    } catch {
      /* Inspect uncertain completion; never retry mutations. */
    }
    return { kind, message, recovery: await inspectRecovery(tool, repo) }
  })
}
