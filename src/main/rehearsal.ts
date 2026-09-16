import { spawn } from 'child_process'
import { mkdtemp, writeFile, rm, realpath } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { tmpdir } from 'os'
import type {
  RehearsalPlan,
  RehearsalAction,
  RehearsalIdentity,
  RehearsalReport,
  RehearsalResult
} from '../shared/types'
import { prepareRebasePlan } from '../shared/rebasePlan'
import { searchPath } from './git/exec'

const repair =
  'Rehearse is internal. Configure GIT_CITY_REHEARSE_BIN with an absolute path to a compatible development build of git-rehearse.'

export function runRehearsalTool(
  tool: string,
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: searchPath(),
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true'
      }
    })
    let stdout = ''
    let stderr = ''
    let bytes = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 16 * 1024 * 1024) {
        child.kill()
        reject(
          new Error('Rehearse returned too much data. Any retained rehearsal remains on disk.')
        )
      } else stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Retain a bounded explanation while continuing to drain the pipe.
      stderr = (stderr + chunk).slice(-64 * 1024)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export async function rehearsalAvailability(
  tool?: string
): Promise<{ available: boolean; configured: boolean; message: string }> {
  if (!tool || !isAbsolute(tool))
    return { available: false, configured: Boolean(tool), message: repair }
  try {
    const result = await runRehearsalTool(tool, ['--version'])
    // The development contract is pinned until bundled-tool compatibility is shipped.
    if (result.code !== 0 || result.stdout.trim() !== 'git-rehearse 1.2.0') {
      return {
        available: false,
        configured: true,
        message: `Unsupported git-rehearse version. ${repair}`
      }
    }
    return {
      available: true,
      configured: true,
      message: 'Internal rehearsal with checked Apply and recovery.'
    }
  } catch {
    return {
      available: false,
      configured: true,
      message: `Could not start the configured tool. ${repair}`
    }
  }
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const string = (v: unknown): v is string => typeof v === 'string'
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(string)
const optionalString = (v: unknown): boolean => v === undefined || string(v)
const count = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const arrayOf = (v: unknown, check: (entry: unknown) => boolean): boolean =>
  Array.isArray(v) && v.every(check)

/** Reject unknown shapes before any renderer consumes them; tolerate extra fields. */
function isReport(v: Record<string, unknown>): v is Record<string, unknown> & RehearsalReport {
  return (
    v.schema === 1 &&
    (v.can_apply === undefined || typeof v.can_apply === 'boolean') &&
    optionalString(v.sandbox) &&
    string(v.id) &&
    v.id.length > 0 &&
    string(v.repository) &&
    string(v.repository_id) &&
    string(v.origin_worktree) &&
    strings(v.command) &&
    object(v.checkout) &&
    ['branch', 'detached'].includes(String(v.checkout.kind)) &&
    string(v.checkout.target) &&
    object(v.pre_state) &&
    Object.values(v.pre_state).every(string) &&
    v.lifecycle === 'kept' &&
    v.decision === 'kept' &&
    ['clean', 'stopped', 'failed', 'incomplete'].includes(String(v.outcome)) &&
    v.execution === v.outcome &&
    typeof v.conflicted === 'boolean' &&
    typeof v.drift_unexpected === 'boolean' &&
    arrayOf(
      v.refs,
      (r) => object(r) && string(r.name) && optionalString(r.before) && optionalString(r.after)
    ) &&
    arrayOf(v.conflicts, (c) => object(c) && string(c.path) && count(c.hunks)) &&
    arrayOf(
      v.drift,
      (d) =>
        object(d) &&
        string(d.reference) &&
        count(d.commits_before) &&
        count(d.commits_after) &&
        arrayOf(d.files, (f) => object(f) && string(f.status) && string(f.path)) &&
        object(d.replay) &&
        strings(d.replay.changed) &&
        strings(d.replay.dropped) &&
        strings(d.replay.added) &&
        typeof d.replay.compared === 'boolean'
    ) &&
    (v.carried === undefined ||
      (object(v.carried) &&
        strings(v.carried.paths) &&
        string(v.carried.status) &&
        strings(v.carried.conflicts) &&
        optionalString(v.carried.reason)))
  )
}

async function report(
  tool: string | undefined,
  cwd: string,
  args: string[],
  expected?: RehearsalIdentity,
  command = args.slice(1)
): Promise<RehearsalResult> {
  const availability = await rehearsalAvailability(tool)
  if (!availability.available || !tool)
    return { kind: 'unavailable', message: availability.message }
  try {
    const origin = await realpath(cwd)
    const result = await runRehearsalTool(tool, ['--json', ...args], origin)
    const value: unknown = JSON.parse(result.stdout)
    if (!object(value) || value.schema !== 1)
      throw new Error(
        'Unsupported Rehearse JSON schema. Update the configured development tool; retained data has not been deleted.'
      )
    if ((value.kind === 'refused' || value.kind === 'internal') && string(value.message)) {
      return { kind: value.kind === 'refused' ? 'refused' : 'error', message: value.message }
    }
    if (!isReport(value))
      throw new Error(
        'Incompatible or incomplete Rehearse result. Retained data has not been deleted; inspect it with the configured tool.'
      )
    if (value.exit_code !== result.code)
      throw new Error('Rehearse process and report disagree about completion.')
    if (
      (await realpath(value.origin_worktree)) !== origin ||
      (await realpath(value.repository)) !== origin
    ) {
      throw new Error('Rehearsal belongs to a different original worktree.')
    }
    if (
      expected &&
      (value.id !== expected.id ||
        value.repository_id !== expected.repository_id ||
        value.repository !== expected.repository ||
        value.origin_worktree !== expected.origin_worktree)
    ) {
      throw new Error('Rehearsal ID or origin does not match the selected result.')
    }
    if (!expected && JSON.stringify(value.command) !== JSON.stringify(command)) {
      throw new Error('Rehearse returned a different action from the requested action.')
    }
    return {
      kind: 'report',
      report: {
        ...value,
        // Plan annotations belong to this app session, not unvalidated CLI extensions.
        plan: undefined,
        diagnostics:
          value.outcome === 'failed'
            ? result.stderr.trim() || 'Git failed without a diagnostic message.'
            : undefined
      }
    }
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'Rehearse failed. No direct action was attempted.'
    }
  }
}

export function rehearseMerge(
  tool: string | undefined,
  repo: string,
  target: string
): Promise<RehearsalResult> {
  return rehearse(tool, repo, 'merge', target)
}

export async function rehearse(
  tool: string | undefined,
  repo: string,
  action: RehearsalAction,
  target: string,
  plan?: RehearsalPlan
): Promise<RehearsalResult> {
  if (
    !['merge', 'rebase', 'cherry-pick'].includes(action) ||
    (action === 'cherry-pick' &&
      (typeof target !== 'string' || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(target))) ||
    typeof repo !== 'string' ||
    !isAbsolute(repo) ||
    typeof target !== 'string' ||
    !target.trim() ||
    target.startsWith('-') ||
    /[\0\r\n]/.test(target)
  ) {
    return { kind: 'refused', message: 'Choose a repository and a branch or commit to rehearse.' }
  }
  if (plan !== undefined) {
    if (!plan || action !== 'rebase' || target !== (plan.base ?? 'root'))
      return { kind: 'refused', message: 'Choose the interactive plan and its original base.' }
    const prepared = prepareRebasePlan(plan)
    if (!prepared.ok) return { kind: 'refused', message: prepared.message }
    const directory = await mkdtemp(join(tmpdir(), 'gitcity-rehearsal-'))
    try {
      const todo = join(directory, 'todo')
      await writeFile(todo, prepared.todo, { mode: 0o600 })
      const command = prepared.command
      const result = await report(
        tool,
        repo,
        ['--keep', '--todo', todo, ...command],
        undefined,
        command
      )
      if (result.kind === 'report') result.report.plan = plan
      return result
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  return report(tool, repo, ['--keep', action, target])
}

export async function rehearsalShow(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<RehearsalResult> {
  if (
    !identity ||
    !string(identity.id) ||
    !/^[a-zA-Z0-9_-]+$/.test(identity.id) ||
    !string(identity.origin_worktree) ||
    !isAbsolute(identity.origin_worktree) ||
    !string(identity.repository_id) ||
    !string(identity.repository)
  ) {
    return { kind: 'refused', message: 'Select an exact rehearsal ID and its original worktree.' }
  }
  return report(tool, identity.origin_worktree, ['show', identity.id], identity)
}

/** Caller serializes this with editing for the same retained rehearsal. */
export async function rehearsalContinue(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<RehearsalResult> {
  const current = await rehearsalShow(tool, identity)
  if (current.kind !== 'report') return current
  if (current.report.outcome !== 'stopped')
    return {
      kind: 'refused',
      message: 'Only a stopped rehearsal can continue. Keep this result and start a new rehearsal.'
    }
  return report(tool, identity.origin_worktree, ['--keep', 'continue', identity.id], identity)
}
