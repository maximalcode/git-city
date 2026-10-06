import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const MAX_TREE_ENTRIES = 2_000
const MAX_HASH_BYTES = 64 * 1024 * 1024
const DEFAULT_DIAGNOSTICS_DEADLINE_MS = 10_000

const json = (value) => JSON.stringify(value, null, 2) + '\n'

/** Run one diagnostic observer against an absolute deadline. The observer may
 * continue in the background after timeout, but it can never hold up smoke. */
export async function withDeadline(operation, deadlineMs, fallback) {
  const remaining = Math.max(0, deadlineMs - Date.now())
  if (remaining === 0) return fallback
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), remaining)
  })
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function bestEffort(
  operation,
  fallback,
  deadlineMs = Date.now() + DEFAULT_DIAGNOSTICS_DEADLINE_MS
) {
  try {
    return await withDeadline(operation, deadlineMs, fallback)
  } catch {
    return fallback
  }
}

export function diagnosticDeadlines(
  startedAt,
  graceMs,
  initialAllowanceMs = 5_000,
  finalAllowanceMs = 10_000
) {
  const observationDeadline = startedAt + Math.max(0, graceMs)
  return {
    initialDeadline: startedAt + Math.max(0, initialAllowanceMs),
    observationDeadline,
    finalDeadline: observationDeadline + Math.max(0, finalAllowanceMs)
  }
}

export async function writeDiagnostics(path, value) {
  try {
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, json(value))
  } catch {
    // Evidence is best-effort; never mask the smoke assertion that triggered it.
  }
}

/** Install in the Electron main process after launch. ChildProcess emits spawn
 * after its pid/args have been assigned, so this also works when the imported
 * main modules captured child_process.spawn before the smoke script ran. */
export async function installMainSpawnDiagnostics(
  app,
  deadlineMs = Date.now() + DEFAULT_DIAGNOSTICS_DEADLINE_MS
) {
  return bestEffort(
    () =>
      app.evaluate(({ ipcMain }) => {
        const stampNow = () => ({ unixMs: Date.now(), monotonicMs: Math.round(performance.now()) })
        const key = '__gitCitySmokeMainDiagnostics'
        const existing = globalThis[key]
        if (existing?.installed) return { installed: true, alreadyInstalled: true }

        const state = {
          installed: false,
          installError: undefined,
          records: [],
          ipcRecords: [],
          active: new Map()
        }
        globalThis[key] = state
        try {
          const childProcess = process.getBuiltinModule?.('node:child_process')
          const prototype = childProcess?.ChildProcess?.prototype
          if (!prototype || typeof prototype.emit !== 'function') {
            state.installError = 'ChildProcess.prototype.emit is unavailable.'
            return { installed: false, error: state.installError }
          }
          const originalEmit = prototype.emit
          prototype.emit = function smokeDiagnosticsEmit(event, ...args) {
            try {
              const pid = typeof this.pid === 'number' ? this.pid : null
              if (event === 'spawn' || event === 'error' || event === 'close') {
                let record = pid === null ? undefined : state.active.get(pid)
                if (!record) {
                  const stamp = stampNow()
                  record = {
                    pid,
                    file: typeof this.spawnfile === 'string' ? this.spawnfile : undefined,
                    args: Array.isArray(this.spawnargs)
                      ? this.spawnargs.map((arg) => String(arg).slice(0, 2_000))
                      : [],
                    started: event === 'spawn' ? stamp : undefined,
                    close: undefined,
                    error: undefined
                  }
                  state.records.push(record)
                  if (pid !== null) state.active.set(pid, record)
                }
                if (event === 'error') {
                  record.error = { name: args[0]?.name, code: args[0]?.code }
                }
                if (event === 'close') {
                  const stamp = stampNow()
                  record.close = {
                    ...stamp,
                    code: typeof args[0] === 'number' ? args[0] : null,
                    signal: typeof args[1] === 'string' ? args[1] : null,
                    durationMs: record.started
                      ? stamp.monotonicMs - record.started.monotonicMs
                      : null
                  }
                  if (pid !== null) state.active.delete(pid)
                }
              }
            } catch {
              // Diagnostics must never change child process behavior.
            }
            return originalEmit.call(this, event, ...args)
          }
          const handlers = ipcMain?._invokeHandlers
          const applyHandler = handlers?.get('git-city:rehearsal-apply')
          if (handlers instanceof Map && typeof applyHandler === 'function') {
            handlers.set('git-city:rehearsal-apply', async (event, identity) => {
              const id = typeof identity?.id === 'string' ? identity.id : null
              const started = { phase: 'start', id, ...stampNow() }
              state.ipcRecords.push(started)
              try {
                const result = await applyHandler(event, identity)
                state.ipcRecords.push({
                  phase: 'result',
                  id,
                  kind: result?.kind,
                  recoveryState: result?.recovery?.state,
                  ...stampNow(),
                  durationMs: Math.round(performance.now() - started.monotonicMs)
                })
                return result
              } catch (error) {
                state.ipcRecords.push({
                  phase: 'error',
                  id,
                  name: error?.name,
                  ...stampNow(),
                  durationMs: Math.round(performance.now() - started.monotonicMs)
                })
                throw error
              }
            })
          } else {
            state.installError = 'The rehearsal Apply IPC handler was not found.'
          }
          state.installed = true
          return {
            installed: true,
            alreadyInstalled: false,
            ipcHooked: handlers instanceof Map && typeof applyHandler === 'function'
          }
        } catch (error) {
          state.installError = error instanceof Error ? error.message : String(error)
          return { installed: false, error: state.installError }
        }
      }),
    { installed: false, error: 'Diagnostics installation timed out.' },
    deadlineMs
  )
}

export async function readMainSpawnDiagnostics(
  app,
  deadlineMs = Date.now() + DEFAULT_DIAGNOSTICS_DEADLINE_MS
) {
  return bestEffort(
    () =>
      app.evaluate(() => {
        const state = globalThis.__gitCitySmokeMainDiagnostics
        return state
          ? {
              installed: state.installed,
              installError: state.installError,
              records: state.records.map((record) => ({ ...record })),
              ipcRecords: (state.ipcRecords ?? []).map((record) => ({ ...record }))
            }
          : {
              installed: false,
              installError: 'Diagnostics were not installed.',
              records: [],
              ipcRecords: []
            }
      }),
    { installed: false, installError: 'Diagnostics read timed out.', records: [], ipcRecords: [] },
    deadlineMs
  )
}

function captureGit(repo, args) {
  try {
    return {
      ok: true,
      value: execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        timeout: 500,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      }).trimEnd()
    }
  } catch (error) {
    return { ok: false, error: error?.code ?? error?.name ?? 'command failed' }
  }
}

async function hashFile(path) {
  try {
    const data = await readFile(path)
    return { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.byteLength }
  } catch (error) {
    return { error: error?.code ?? error?.name ?? 'read failed' }
  }
}

/** A read-only snapshot with exact Git and file hashes. No command output that
 * could contain credentials is captured. */
export async function snapshotRepo(repo, phase) {
  const indexPath = captureGit(repo, ['rev-parse', '--git-path', 'index'])
  const resolvedIndex = indexPath.ok ? resolve(repo, indexPath.value) : join(repo, '.git', 'index')
  const filePath = join(repo, 'file.txt')
  return {
    phase,
    capturedAt: new Date().toISOString(),
    git: {
      head: captureGit(repo, ['rev-parse', 'HEAD']),
      symbolicHead: captureGit(repo, ['symbolic-ref', '--short', '-q', 'HEAD']),
      indexGitHash: captureGit(repo, ['hash-object', resolvedIndex]),
      statusPorcelainV2: captureGit(repo, ['status', '--porcelain=v2', '--untracked-files=all']),
      indexPath: indexPath.ok ? indexPath.value : undefined,
      lsFilesStage: captureGit(repo, ['ls-files', '--stage'])
    },
    files: {
      fileTxt: await hashFile(filePath),
      indexBytes: await hashFile(resolvedIndex)
    }
  }
}

async function treeSnapshot(root, label, replacements = []) {
  const entries = []
  let truncated = false
  const visit = async (directory) => {
    if (entries.length >= MAX_TREE_ENTRIES) {
      truncated = true
      return
    }
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (entries.length >= MAX_TREE_ENTRIES) {
        truncated = true
        return
      }
      const path = join(directory, child.name)
      let info
      try {
        info = await lstat(path)
      } catch {
        continue
      }
      if (info.isSymbolicLink()) continue
      const name = relative(root, path)
      if (info.isDirectory()) {
        await visit(path)
      } else {
        const item = { path: `${label}/${name}`, bytes: info.size, mtimeMs: info.mtimeMs }
        if (info.size <= MAX_HASH_BYTES) item.sha256 = (await hashFile(path)).sha256
        if (info.size <= 1_024 * 1_024 && /\.(?:json|toml)$/i.test(child.name)) {
          try {
            let text = await readFile(path, 'utf8')
            for (const [from, to] of replacements) text = text.replaceAll(from, to)
            item.text = text
          } catch {
            // The hash and filesystem metadata remain useful for binary files.
          }
        }
        entries.push(item)
      }
    }
  }
  await visit(root)
  return { root: label, entries, truncated }
}

export async function snapshotRetainedMetadata(profile, repo, phase) {
  return {
    phase,
    capturedAt: new Date().toISOString(),
    trees: [
      await treeSnapshot(join(profile, 'cache'), 'cache', [
        [profile, '<PROFILE>'],
        [repo, '<REPO>']
      ]),
      await treeSnapshot(join(repo, '.git'), 'repo/.git', [
        [profile, '<PROFILE>'],
        [repo, '<REPO>']
      ])
    ]
  }
}

export async function capturePageEvidence(
  page,
  directory,
  phase,
  deadlineMs = Date.now() + DEFAULT_DIAGNOSTICS_DEADLINE_MS
) {
  const created = await bestEffort(() => mkdir(directory, { recursive: true }), false, deadlineMs)
  if (created === false) return
  const stem = phase === 'original-timeout' ? 'original-timeout' : 'after-grace'
  const screenshotError = await bestEffort(
    async () => {
      try {
        await page.screenshot({ path: join(directory, `${stem}.png`), timeout: 10_000 })
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    'Screenshot capture timed out.',
    deadlineMs
  )
  if (screenshotError)
    await bestEffort(
      () =>
        writeDiagnostics(join(directory, `${stem}-screenshot-error.json`), {
          error: screenshotError
        }),
      undefined,
      deadlineMs
    )
  const contentResult = await bestEffort(
    async () => {
      try {
        return { content: await page.content() }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },
    { error: 'DOM capture timed out.' },
    deadlineMs
  )
  if (typeof contentResult.content === 'string') {
    await bestEffort(
      () => writeFile(join(directory, `${stem}.html`), contentResult.content),
      undefined,
      deadlineMs
    )
  } else {
    await bestEffort(
      () =>
        writeDiagnostics(join(directory, `${stem}-dom-error.json`), {
          error: contentResult.error
        }),
      undefined,
      deadlineMs
    )
  }
}

/** Recovery/list/show are deliberately called only after the Apply bridge has
 * returned. They are public read paths and their result is reduced to safe
 * state labels before being persisted. */
export async function capturePostApplyPublicState(
  page,
  repo,
  deadlineMs = Date.now() + DEFAULT_DIAGNOSTICS_DEADLINE_MS
) {
  return bestEffort(
    () =>
      page.evaluate(async (repository) => {
        const api = window.gitCity
        const recovery = await api.rehearsalRecovery(repository)
        const inventory = await api.rehearsalList(repository)
        const entries = inventory.entries.map((entry) => ({
          id: entry.id,
          execution: entry.execution,
          lifecycle: entry.lifecycle,
          active: entry.active,
          stale: entry.stale
        }))
        const shown = []
        for (const entry of inventory.entries) {
          const value = await api.rehearsalShow(entry)
          shown.push({
            id: entry.id,
            kind: value?.kind,
            outcome: value?.kind === 'report' ? value.report.outcome : undefined,
            message: value?.kind === 'report' ? undefined : value?.message
          })
        }
        return {
          recovery: {
            state: recovery.state,
            operation: recovery.operation,
            canComplete: recovery.can_complete,
            canRollback: recovery.can_rollback
          },
          inventory: { entries, protected: inventory.protected, lowSpace: inventory.lowSpace },
          shown
        }
      }, repo),
    { diagnosticError: 'Public Apply state capture timed out.' },
    deadlineMs
  )
}

export function applyHasReturned(mainDiagnostics) {
  const records = mainDiagnostics.ipcRecords ?? []
  return records.some((record) => record.phase === 'result' || record.phase === 'error')
}

export function applyHasStarted(mainDiagnostics) {
  const records = mainDiagnostics.ipcRecords ?? []
  return records.some((record) => record.phase === 'start')
}

export function printProcessDiagnostics(restart, diagnostics) {
  for (const record of diagnostics.records ?? []) {
    console.log(`[smoke-diagnostics] restart=${restart} ${JSON.stringify(record)}`)
  }
  if (diagnostics.installError) {
    console.log(
      `[smoke-diagnostics] restart=${restart} installError=${JSON.stringify(diagnostics.installError)}`
    )
  }
}
