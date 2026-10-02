import { verifyRehearsalInvocation } from './rehearsalBundle'
import { spawn } from 'child_process'
import { realpath } from 'fs/promises'
import type { OpResult, RehearsalResult } from '../shared/types'
import { searchPath } from './git/exec'

type Execution = { stop(): Promise<void>; done: Promise<void> }
const executions = new Map<string, Execution>()
export interface RehearsalExecution {
  check(): void
}
type PendingExecution = RehearsalExecution & { cancelled: boolean; done: Promise<void> }
const pending = new Map<string, PendingExecution>()

/** Register before the first asynchronous preparation step, including queued Continue. */
export async function withRehearsalExecution(
  repo: string,
  operation: (execution: RehearsalExecution) => Promise<RehearsalResult>
): Promise<RehearsalResult> {
  if (pending.has(repo))
    return { kind: 'refused', message: 'A rehearsal is already running in this worktree.' }
  let finish!: () => void
  const execution: PendingExecution = {
    cancelled: false,
    done: new Promise<void>((resolve) => {
      finish = resolve
    }),
    check() {
      if (this.cancelled)
        throw new Error('Execution stopped before launch. Retained work has been preserved.')
    }
  }
  pending.set(repo, execution)
  let origin: string | undefined
  try {
    origin = await realpath(repo)
    if (pending.has(origin) && pending.get(origin) !== execution)
      throw new Error('A rehearsal is already running in this worktree.')
    pending.set(origin, execution)
    execution.check()
    return await operation(execution)
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Rehearsal could not run.'
    }
  } finally {
    if (pending.get(repo) === execution) pending.delete(repo)
    if (origin && pending.get(origin) === execution) pending.delete(origin)
    finish()
  }
}

/** Apply/recovery are never registered here. Ownership is a live child handle,
 * not a persisted PID or the CLI's implicitly latest rehearsal. */
export async function stopRehearsal(repo: string): Promise<OpResult> {
  try {
    const preparation = pending.get(repo) ?? pending.get(await realpath(repo))
    if (preparation) preparation.cancelled = true
    const execution = executions.get(await realpath(repo))
    if (!execution && !preparation)
      return { ok: false, message: 'No app-owned rehearsal is running in this worktree.' }
    await execution?.stop()
    await execution?.done
    await preparation?.done
    return {
      ok: true,
      message: 'Execution ended. Retained state will be reloaded; continuation is not guaranteed.'
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not stop rehearsal.'
    }
  }
}

// The CLI reserves a rehearsal even during `show`. Serialize this app's public
// inventory/report reads so a read reservation cannot masquerade as execution.
const inspections = new Map<string, Promise<unknown>>()
export function runRehearsalTool(
  tool: string,
  args: string[],
  cwd?: string,
  stoppable = false
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!cwd || args[0] !== '--json' || !['show', 'list'].includes(args[1]))
    return spawnRehearsalTool(tool, args, cwd, stoppable)
  const result = (inspections.get(cwd) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => spawnRehearsalTool(tool, args, cwd, stoppable))
  inspections.set(cwd, result)
  void result
    .finally(() => {
      if (inspections.get(cwd) === result) inspections.delete(cwd)
    })
    .catch(() => undefined)
  return result
}

async function spawnRehearsalTool(
  tool: string,
  args: string[],
  cwd?: string,
  stoppable = false
): Promise<{ code: number; stdout: string; stderr: string }> {
  await verifyRehearsalInvocation(tool)
  return new Promise((resolve, reject) => {
    if (stoppable && (!cwd || executions.has(cwd))) {
      reject(new Error('A rehearsal is already running in this worktree.'))
      return
    }
    const child = spawn(tool, args, {
      cwd,
      detached: stoppable && process.platform !== 'win32',
      windowsHide: true,
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
    let stopping: Promise<void> | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    let closed = false
    let finish!: () => void
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const stop = (): Promise<void> => {
      if (stopping) return stopping
      stopping = (async () => {
        if (closed || !child.pid) return
        if (process.platform === 'win32') {
          // Terminate the owned process tree, including Git/merge-driver children.
          await new Promise<void>((resolve, reject) => {
            const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore'
            })
            killer.on('error', reject)
            killer.on('close', (code) =>
              code === 0 || closed
                ? resolve()
                : reject(new Error('Could not terminate the rehearsal process tree.'))
            )
          })
        } else {
          const signal = (value: NodeJS.Signals): void => {
            try {
              process.kill(-child.pid!, value)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
            }
          }
          signal('SIGTERM')
          escalation = setTimeout(() => {
            if (!closed) signal('SIGKILL')
          }, 3000)
        }
      })()
      return stopping
    }
    if (stoppable) executions.set(cwd!, { stop, done })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 16 * 1024 * 1024) {
        if (stoppable) void stop().catch(() => undefined)
        else child.kill()
        reject(
          new Error('Rehearse returned too much data. Any retained rehearsal remains on disk.')
        )
      } else stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-64 * 1024)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      closed = true
      clearTimeout(escalation)
      if (stoppable) executions.delete(cwd!)
      finish()
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
