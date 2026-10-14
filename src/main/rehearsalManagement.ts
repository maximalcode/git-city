import { withRehearsal } from './rehearsalConflicts'
import { lstat, readdir, realpath, statfs } from 'fs/promises'
import { dirname, isAbsolute, join, resolve } from 'path'
import type {
  RehearsalDiscardResult,
  RehearsalEntry,
  RehearsalIdentity,
  RehearsalInventory
} from '../shared/types'
import { runGit } from './git/exec'
import { rehearsalAvailability, runRehearsalTool } from './rehearsal'
import { inspectRecovery } from './rehearsalRecovery'
import { withRepositoryWrite } from './repositoryQueue'
import { discardRehearsalDrafts } from './rehearsalDraftIpc'

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const path = (v: unknown): v is string => text(v) && isAbsolute(v)
const messages = (error: unknown): string =>
  error instanceof Error ? error.message : 'Could not inspect retained data.'

interface Listed extends RehearsalIdentity {
  command: string[]
  checkout: RehearsalEntry['checkout']
  pre_state: Record<string, string>
  created_unix: number
  execution: RehearsalEntry['execution']
  lifecycle: RehearsalEntry['lifecycle']
  active: boolean
  storage: { root: string }
}
function isEntry(v: unknown): v is Listed {
  return (
    object(v) &&
    text(v.id) &&
    /^[a-zA-Z0-9_-]+$/.test(v.id) &&
    path(v.repository) &&
    path(v.origin_worktree) &&
    text(v.repository_id) &&
    Array.isArray(v.command) &&
    v.command.every(text) &&
    object(v.checkout) &&
    ['branch', 'detached'].includes(String(v.checkout.kind)) &&
    text(v.checkout.target) &&
    object(v.pre_state) &&
    Object.values(v.pre_state).every(text) &&
    typeof v.created_unix === 'number' &&
    Number.isSafeInteger(v.created_unix) &&
    v.created_unix >= 0 &&
    ['clean', 'stopped', 'failed', 'incomplete'].includes(String(v.execution)) &&
    ['kept', 'fresh'].includes(String(v.lifecycle)) &&
    typeof v.active === 'boolean' &&
    object(v.storage) &&
    path(v.storage.root)
  )
}

async function listing(
  tool: string | undefined,
  repo: string
): Promise<{ tool: string; origin: string; entries: Listed[] }> {
  const available = await rehearsalAvailability(tool)
  if (!available.available || !tool) throw new Error(available.message)
  const origin = await realpath(repo)
  const response = await runRehearsalTool(tool, ['--json', 'list'], origin)
  const value: unknown = JSON.parse(response.stdout)
  if (object(value) && text(value.message)) throw new Error(value.message)
  if (
    response.code !== 0 ||
    !object(value) ||
    value.schema !== 1 ||
    !Array.isArray(value.rehearsals) ||
    !value.rehearsals.every(isEntry)
  )
    throw new Error(
      'Incompatible rehearsal inventory. Use a development build with active-execution protection (#105). Retained data has not been deleted.'
    )
  const entries: Listed[] = []
  for (const entry of value.rehearsals) {
    // Never reassign another worktree's history to the currently open one.
    if (entry.origin_worktree !== origin || entry.repository !== origin) continue
    if (entries.some((item) => item.id === entry.id))
      throw new Error('Duplicate rehearsal identity in inventory.')
    entries.push(entry)
  }
  return { tool, origin, entries }
}

/** Cache location follows the pinned CLI's documented environment/platform precedence. */
function cacheRoot(repo: string): string | null {
  if (process.env.GIT_REHEARSE_CACHE_DIR) return resolve(repo, process.env.GIT_REHEARSE_CACHE_DIR)
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg && isAbsolute(xdg)) return join(xdg, 'git-rehearse')
  const home = process.env.HOME
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA
      : home && join(home, process.platform === 'darwin' ? 'Library/Caches' : '.cache')
  return base ? join(base, 'git-rehearse') : null
}

async function availableSpace(
  root: string | null,
  nearestExisting = false
): Promise<number | null> {
  if (!root) return null
  try {
    const volume = await statfs(root)
    return volume.bavail * volume.bsize
  } catch (error) {
    // A first rehearsal may not have created its cache directory yet.
    if (
      nearestExisting &&
      (error as NodeJS.ErrnoException).code === 'ENOENT' &&
      dirname(root) !== root
    )
      return availableSpace(dirname(root), true)
    return null
  }
}

/** Logical bytes, without following symlinks or counting hard links as freeable space. */
async function storage(root: string): Promise<{ bytes: number | null; freeBytes: number | null }> {
  let bytes: number | null = null
  const freeBytes = await availableSpace(root)
  try {
    const count = async (entry: string): Promise<number> => {
      const stat = await lstat(entry)
      if (stat.isSymbolicLink()) return stat.size
      if (!stat.isDirectory()) return stat.size
      let total = 0
      for (const name of await readdir(entry)) total += await count(join(entry, name))
      return total
    }
    bytes = await count(root)
  } catch {
    /* A concurrent change or read failure makes the total unknown. */
  }
  return { bytes, freeBytes }
}

export async function listRehearsals(
  tool: string | undefined,
  repo: string
): Promise<RehearsalInventory> {
  const listed = await listing(tool, repo)
  // Active history must remain readable so the user can inspect and Stop it.
  // Defer the journal-owning recovery command and conservatively protect data.
  const recovery = listed.entries.some((entry) => entry.active)
    ? { state: 'unknown', message: 'Recovery inspection is deferred while a rehearsal is active.' }
    : await withRepositoryWrite(listed.origin, () => inspectRecovery(tool, listed.origin))
  const refs = new Map(
    (await runGit(listed.origin, ['for-each-ref', '--format=%(refname) %(objectname)']))
      .trim()
      .split('\n')
      .map((line) => {
        const [name, hash] = line.split(' ')
        return [name, hash]
      })
  )
  const head = (await runGit(listed.origin, ['rev-parse', 'HEAD'])).trim()
  const checkout = (
    await runGit(listed.origin, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')
  ).trim()
  const entries: RehearsalEntry[] = []
  for (const entry of listed.entries) {
    const size = await storage(entry.storage.root)
    entries.push({
      id: entry.id,
      repository: entry.repository,
      origin_worktree: entry.origin_worktree,
      repository_id: entry.repository_id,
      command: entry.command,
      checkout: entry.checkout,
      pre_state: entry.pre_state,
      created_unix: entry.created_unix,
      execution: entry.execution,
      lifecycle: entry.lifecycle,
      active: entry.active,
      stale:
        (entry.checkout.kind === 'branch'
          ? checkout !== `refs/heads/${entry.checkout.target}`
          : !!checkout || head !== entry.checkout.target) ||
        Object.entries(entry.pre_state).some(
          ([name, hash]) => (name === 'HEAD' ? head : refs.get(name)) !== hash
        ),
      ...size
    })
  }
  const knownFree = entries.flatMap((entry) => (entry.freeBytes === null ? [] : [entry.freeBytes]))
  const freeBytes =
    entries.length === 0
      ? await availableSpace(cacheRoot(listed.origin), true)
      : knownFree.length === entries.length
        ? Math.min(...knownFree)
        : null
  return {
    repository: listed.origin,
    entries: entries.sort((a, b) => b.created_unix - a.created_unix || b.id.localeCompare(a.id)),
    bytes: entries.some((entry) => entry.bytes === null)
      ? null
      : entries.reduce((sum, entry) => sum + entry.bytes!, 0),
    freeBytes,
    lowSpace:
      (freeBytes !== null && freeBytes < 1024 ** 3) || knownFree.some((bytes) => bytes < 1024 ** 3),
    protected: recovery.state !== 'none',
    warning:
      recovery.state !== 'none'
        ? recovery.message
        : freeBytes === null ||
            entries.some((entry) => entry.bytes === null || entry.freeBytes === null)
          ? 'Some storage measurements are unavailable. No data was deleted.'
          : undefined
  }
}

/** Re-list and match every full identity. Never pass --all or an ID prefix. The
 * CLI owns the atomic active/recovery checks at deletion, including external races. */
export async function discardRehearsals(
  tool: string | undefined,
  repo: string,
  identities: RehearsalIdentity[]
): Promise<RehearsalDiscardResult> {
  if (
    !Array.isArray(identities) ||
    identities.length === 0 ||
    identities.some((entry) => !entry || !text(entry.id))
  )
    throw new Error('Choose exact rehearsal identities to discard.')
  const result: RehearsalDiscardResult = { discarded: [], failures: [] }
  for (const identity of identities) {
    try {
      // Refuse active work promptly rather than queue deletion behind its execution.
      const initial = await listing(tool, repo)
      if (initial.entries.some((entry) => entry.id === identity.id && entry.active))
        throw new Error('Rehearsal is active. Stop its execution before discarding.')
      await withRepositoryWrite(repo, () =>
        withRehearsal(identity, async () => {
          const listed = await listing(tool, repo)
          const entry = listed.entries.find(
            (item) =>
              item.id === identity.id &&
              item.repository === identity.repository &&
              item.repository_id === identity.repository_id &&
              item.origin_worktree === identity.origin_worktree
          )
          if (!entry)
            throw new Error(
              'Exact rehearsal identity is no longer present in this worktree. Refresh the inventory.'
            )
          if (entry.active)
            throw new Error('Rehearsal is active. Stop its execution before discarding.')
          const response = await runRehearsalTool(
            listed.tool,
            ['--json', 'discard', entry.id],
            listed.origin
          )
          const value: unknown = JSON.parse(response.stdout)
          if (object(value) && text(value.message)) throw new Error(value.message)
          if (
            response.code !== 0 ||
            !object(value) ||
            value.schema !== 1 ||
            value.exit_code !== 0 ||
            !Array.isArray(value.discarded) ||
            value.discarded.length !== 1 ||
            value.discarded[0] !== entry.id
          )
            throw new Error(
              'Discard completion is uncertain. Refresh the inventory before trying again.'
            )
          try {
            await discardRehearsalDrafts(entry)
          } catch (error) {
            throw new Error(error instanceof Error ? error.message : 'Local drafts were kept.')
          }
          result.discarded.push(entry.id)
        })
      )
    } catch (error) {
      result.failures.push({ id: identity.id, message: messages(error) })
    }
  }
  return result
}
