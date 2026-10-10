import { randomUUID } from 'crypto'
import { mkdir, open, readFile, realpath, rename, rm } from 'fs/promises'
import { dirname, isAbsolute } from 'path'
import type {
  RehearsalDraftChoice,
  RehearsalDraftDiscardResult,
  RehearsalDraftKey,
  RehearsalDraftListResult,
  RehearsalDraftPayload,
  RehearsalDraftReadResult,
  RehearsalDraftRecord,
  RehearsalDraftWriteResult,
  RehearsalIdentity
} from '../shared/types'

interface DraftFile {
  schema: 1
  records: RehearsalDraftRecord[]
  /** Raw records from a file that could not be interpreted. Never discarded by a write. */
  unknown?: unknown[]
}

interface LoadedFile {
  file: DraftFile
  status: 'ok' | 'unknown'
  message?: string
}

const queues = new Map<string, Promise<void>>()

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const positiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const choices = new Set<RehearsalDraftChoice>(['ours', 'theirs', 'both', 'edit'])

function validRelativePath(path: unknown): path is string {
  return (
    text(path) &&
    path.length > 0 &&
    !isAbsolute(path) &&
    !/[\\\0:]/.test(path) &&
    path
      .split('/')
      .every((part) => part.length > 0 && part !== '.' && part !== '..' && part !== '.git')
  )
}

function validKey(value: unknown): value is RehearsalDraftKey {
  return (
    object(value) &&
    text(value.repository) &&
    isAbsolute(value.repository) &&
    text(value.origin_worktree) &&
    isAbsolute(value.origin_worktree) &&
    text(value.repository_id) &&
    text(value.rehearsal_id) &&
    validRelativePath(value.path)
  )
}

function validRecord(value: unknown): value is RehearsalDraftRecord {
  if (!object(value)) return false
  if (
    value.schema !== 1 ||
    !validKey(value.key) ||
    !text(value.base_revision) ||
    !text(value.base_content) ||
    !['hunks', 'whole-file'].includes(String(value.mode)) ||
    !(value.whole_file_text === null || text(value.whole_file_text)) ||
    !object(value.choices) ||
    !Object.values(value.choices).every(
      (choice) => text(choice) && choices.has(choice as RehearsalDraftChoice)
    ) ||
    !object(value.edits) ||
    !Object.values(value.edits).every(text) ||
    !Array.isArray(value.acknowledged_hunks) ||
    !value.acknowledged_hunks.every(text) ||
    !positiveInt(value.draft_revision) ||
    typeof value.saved_at_unix !== 'number' ||
    !Number.isSafeInteger(value.saved_at_unix) ||
    value.saved_at_unix < 0
  )
    return false
  return true
}

function validFile(value: unknown): value is DraftFile {
  return (
    object(value) &&
    value.schema === 1 &&
    Array.isArray(value.records) &&
    value.records.every(validRecord) &&
    (value.unknown === undefined || Array.isArray(value.unknown))
  )
}

function sameKey(a: RehearsalDraftKey, b: RehearsalDraftKey): boolean {
  return (
    a.repository === b.repository &&
    a.origin_worktree === b.origin_worktree &&
    a.repository_id === b.repository_id &&
    a.rehearsal_id === b.rehearsal_id &&
    a.path === b.path
  )
}

function emptyFile(): DraftFile {
  return { schema: 1, records: [] }
}

async function loadFile(file: string): Promise<LoadedFile> {
  let raw: string | undefined
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    const parsed: unknown = raw === undefined ? undefined : JSON.parse(raw)
    if (validFile(parsed)) return { file: parsed, status: 'ok' }
  } catch {
    /* Try the previous valid snapshot below. */
  }
  try {
    const previous = JSON.parse(await readFile(file + '.previous', 'utf8')) as unknown
    if (validFile(previous)) {
      return {
        file: {
          ...previous,
          unknown: [...(previous.unknown ?? []), ...(raw === undefined ? [] : [raw])]
        },
        status: 'unknown',
        message:
          'The latest draft store was missing or incompatible; the previous valid drafts were restored.'
      }
    }
  } catch {
    /* Both snapshots are unavailable or invalid. Preserve the next write's unknown marker. */
  }
  if (raw === undefined) return { file: emptyFile(), status: 'ok' }
  return {
    file: { schema: 1, records: [], unknown: [raw] },
    status: 'unknown',
    message:
      'The draft store was incompatible; existing data was preserved and no draft was assumed.'
  }
}

async function persist(file: string, value: DraftFile): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const output = JSON.stringify(value) + '\n'
  let previous: string | null = null
  try {
    const current = await readFile(file, 'utf8')
    try {
      if (validFile(JSON.parse(current))) previous = current
    } catch {
      // An incompatible primary must never replace the last valid backup.
      // loadFile has retained its uninterpreted bytes in value.unknown.
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    previous = output
  }
  if (previous !== null) await publishSnapshot(file + '.previous', previous)
  await publishSnapshot(file, output)
}

async function publishSnapshot(file: string, output: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(output, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, file)
    // Windows does not support opening a directory for fsync. The file itself
    // is flushed on every platform before its atomic replacement is published.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(file), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function serial<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const prior = queues.get(file) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolveRelease) => {
    release = resolveRelease
  })
  const next = prior.then(() => current)
  queues.set(file, next)
  await prior
  try {
    return await operation()
  } finally {
    release()
    if (queues.get(file) === next) queues.delete(file)
  }
}

/** Resolve the canonical ownership key once, before accessing local storage. */
export async function rehearsalDraftKey(
  identity: RehearsalIdentity,
  path: string
): Promise<RehearsalDraftKey> {
  if (
    !identity ||
    !text(identity.repository) ||
    !text(identity.origin_worktree) ||
    !text(identity.repository_id) ||
    !text(identity.id) ||
    !validRelativePath(path)
  )
    throw new Error('Choose a valid rehearsal conflict path.')
  const [repository, origin_worktree] = await Promise.all([
    realpath(identity.repository),
    realpath(identity.origin_worktree)
  ])
  return {
    repository,
    origin_worktree,
    repository_id: identity.repository_id,
    rehearsal_id: identity.id,
    path
  }
}

export async function readRehearsalDraft(
  file: string,
  identity: RehearsalIdentity,
  path: string
): Promise<RehearsalDraftReadResult> {
  const key = await rehearsalDraftKey(identity, path)
  return serial(file, async () => {
    let loaded: LoadedFile
    try {
      loaded = await loadFile(file)
    } catch (error) {
      return {
        status: 'error',
        record: null,
        message:
          error instanceof Error
            ? `Could not read saved drafts: ${error.message}`
            : 'Could not read saved drafts.'
      }
    }
    const record = loaded.file.records.find((candidate) => sameKey(candidate.key, key)) ?? null
    if (record) {
      return {
        status: loaded.status === 'unknown' ? 'unknown' : 'saved',
        record,
        ...(loaded.message ? { message: loaded.message } : {})
      }
    }
    return {
      status: loaded.status === 'unknown' ? 'unknown' : 'absent',
      record: null,
      ...(loaded.message ? { message: loaded.message } : {})
    }
  })
}

/** Conservative Apply admission check: any retained draft blocks Apply. */
export async function hasRehearsalDrafts(
  file: string,
  identity: RehearsalIdentity
): Promise<boolean> {
  const key = await rehearsalDraftKey(identity, 'placeholder')
  return serial(file, async () => {
    const loaded = await loadFile(file)
    if (loaded.status === 'unknown')
      throw new Error('The draft store is incompatible; review or recover drafts before Apply.')
    return loaded.file.records.some(
      (record) =>
        record.key.repository === key.repository &&
        record.key.origin_worktree === key.origin_worktree &&
        record.key.repository_id === key.repository_id &&
        record.key.rehearsal_id === key.rehearsal_id
    )
  })
}

export async function writeRehearsalDraft(
  file: string,
  identity: RehearsalIdentity,
  path: string,
  payload: RehearsalDraftPayload,
  expectedDraftRevision: number | null
): Promise<RehearsalDraftWriteResult> {
  const key = await rehearsalDraftKey(identity, path)
  if (
    !payload ||
    !text(payload.base_revision) ||
    !text(payload.base_content) ||
    !['hunks', 'whole-file'].includes(payload.mode) ||
    !(payload.whole_file_text === null || text(payload.whole_file_text)) ||
    !object(payload.choices) ||
    !Object.values(payload.choices).every((choice) => choices.has(choice)) ||
    !object(payload.edits) ||
    !Object.values(payload.edits).every(text) ||
    !Array.isArray(payload.acknowledged_hunks) ||
    !payload.acknowledged_hunks.every(text) ||
    !(expectedDraftRevision === null || positiveInt(expectedDraftRevision))
  )
    return { status: 'error', record: null, message: 'The conflict draft payload is invalid.' }
  return serial(file, async () => {
    let loaded: LoadedFile
    try {
      loaded = await loadFile(file)
    } catch (error) {
      return {
        status: 'error',
        record: null,
        message:
          error instanceof Error
            ? `Could not read saved drafts: ${error.message}`
            : 'Could not read saved drafts.'
      }
    }
    const previous = loaded.file.records.find((candidate) => sameKey(candidate.key, key)) ?? null
    if ((previous?.draft_revision ?? null) !== expectedDraftRevision) {
      return {
        status: 'conflict',
        record: previous,
        message: 'A newer saved draft exists. Reload it before saving this draft.'
      }
    }
    const record: RehearsalDraftRecord = {
      schema: 1,
      key,
      base_revision: payload.base_revision,
      base_content: payload.base_content,
      mode: payload.mode,
      whole_file_text: payload.whole_file_text,
      choices: { ...payload.choices },
      edits: { ...payload.edits },
      acknowledged_hunks: [...payload.acknowledged_hunks],
      draft_revision: (previous?.draft_revision ?? 0) + 1,
      saved_at_unix: Date.now()
    }
    const records = loaded.file.records.filter((candidate) => !sameKey(candidate.key, key))
    records.push(record)
    try {
      await persist(file, { schema: 1, records, unknown: loaded.file.unknown })
    } catch (error) {
      return {
        status: 'error',
        record: previous,
        message:
          error instanceof Error
            ? `Could not save this draft: ${error.message}`
            : 'Could not save this draft.'
      }
    }
    return { status: 'saved', record }
  })
}

/** Includes saved drafts whose sandbox path was staged or removed externally. */
export async function listRehearsalDrafts(
  file: string,
  identity: RehearsalIdentity
): Promise<RehearsalDraftListResult> {
  const key = await rehearsalDraftKey(identity, 'placeholder')
  return serial(file, async () => {
    const loaded = await loadFile(file)
    return {
      status: loaded.status === 'unknown' ? 'unknown' : 'saved',
      records: loaded.file.records.filter((record) =>
        sameKey(record.key, { ...key, path: record.key.path })
      ),
      message: loaded.message
    }
  })
}

export async function discardRehearsalDraft(
  file: string,
  identity: RehearsalIdentity,
  path: string,
  expectedDraftRevision: number | null
): Promise<RehearsalDraftDiscardResult> {
  const key = await rehearsalDraftKey(identity, path)
  if (!(expectedDraftRevision === null || positiveInt(expectedDraftRevision)))
    return {
      status: 'error',
      draft_revision: null,
      message: 'The saved draft revision is invalid.'
    }
  return serial(file, async () => {
    let loaded: LoadedFile
    try {
      loaded = await loadFile(file)
    } catch (error) {
      return {
        status: 'error',
        draft_revision: null,
        message:
          error instanceof Error
            ? `Could not read saved drafts: ${error.message}`
            : 'Could not read saved drafts.'
      }
    }
    const previous = loaded.file.records.find((candidate) => sameKey(candidate.key, key)) ?? null
    if (!previous) return { status: 'absent', draft_revision: null }
    if (previous.draft_revision !== expectedDraftRevision)
      return {
        status: 'conflict',
        draft_revision: previous.draft_revision,
        message: 'The saved draft changed. It was kept.'
      }
    try {
      await persist(file, {
        schema: 1,
        records: loaded.file.records.filter((candidate) => !sameKey(candidate.key, key)),
        unknown: loaded.file.unknown
      })
    } catch (error) {
      return {
        status: 'error',
        draft_revision: previous.draft_revision,
        message:
          error instanceof Error
            ? `Could not discard this draft: ${error.message}`
            : 'Could not discard this draft.'
      }
    }
    return { status: 'absent', draft_revision: previous.draft_revision }
  })
}

/** Remove every draft owned by one exact rehearsal after the tool confirms discard. */
export async function discardRehearsalDraftsFor(
  file: string,
  identity: RehearsalIdentity
): Promise<void> {
  const key = await rehearsalDraftKey(identity, 'placeholder')
  await serial(file, async () => {
    let loaded: LoadedFile
    try {
      loaded = await loadFile(file)
    } catch {
      throw new Error(
        'Rehearsal was discarded, but its local drafts could not be inspected; they were kept.'
      )
    }
    const records = loaded.file.records.filter(
      (record) =>
        record.key.repository !== key.repository ||
        record.key.origin_worktree !== key.origin_worktree ||
        record.key.repository_id !== key.repository_id ||
        record.key.rehearsal_id !== key.rehearsal_id
    )
    if (records.length === loaded.file.records.length) return
    try {
      await persist(file, { schema: 1, records, unknown: loaded.file.unknown })
    } catch {
      throw new Error(
        'Rehearsal was discarded, but its local drafts could not be removed; they were kept.'
      )
    }
  })
}
