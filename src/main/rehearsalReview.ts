import { createHash } from 'crypto'
import { realpath } from 'fs/promises'
import { isAbsolute, relative, sep } from 'path'
import type {
  DiffHunk,
  DiffLine,
  RehearsalIdentity,
  RehearsalReport,
  RehearsalReviewAvailability,
  RehearsalReviewEntry,
  RehearsalReviewFileResult,
  RehearsalReviewFileView,
  RehearsalReviewFilesResult,
  RehearsalReviewScope,
  RehearsalReviewScopeKind,
  RehearsalReviewReplay,
  RehearsalReviewSummary
} from '../shared/types'
import { rehearsalComparisonKey } from '../shared/rehearsalComparison'
import { runGit, runGitBuffer, runGitResult } from './git/exec'
import { rehearsalShow } from './rehearsal'
import { resolveRehearsalEndpoints } from './rehearsalComparison'
import { withRehearsal } from './rehearsalConflicts'

export const REHEARSAL_REVIEW_BLOB_LIMIT = 2 * 1024 * 1024
export const REHEARSAL_REVIEW_PATCH_LIMIT = 4 * 1024 * 1024
export const REHEARSAL_REVIEW_PAGE_SIZE = 200
const RENAME_DETECTION_ENTRY_LIMIT = 400
const BLOB_READ_CONCURRENCY = 4

const inside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

type RawEntry = {
  oldMode: string
  newMode: string
  oldId: string
  newId: string
  status: string
  oldPath: string | null
  newPath: string | null
}

type BlobText =
  | { kind: 'text'; text: string; lines: number }
  | { kind: 'pointer'; text: string; lines: 1 }
  | { kind: 'binary' }
  | { kind: 'too-large' }
  | { kind: 'missing' }

type ReviewData = {
  report: RehearsalReport
  identity: RehearsalIdentity
  revision: string
  scope: RehearsalReviewScope
  entries: RehearsalReviewEntry[]
  root: string
  scopes: Map<string, { scope: RehearsalReviewScope; entries: RehearsalReviewEntry[] }>
}

type ScopeData = { scope: RehearsalReviewScope; entries: RehearsalReviewEntry[] }

function identityOf(report: RehearsalReport): RehearsalIdentity {
  return {
    id: report.id,
    repository: report.repository,
    repository_id: report.repository_id,
    origin_worktree: report.origin_worktree
  }
}

function revisionOf(
  report: RehearsalReport,
  endpoints: string[],
  scopeKeys: string[] = []
): string {
  return createHash('sha256')
    .update(rehearsalComparisonKey(report))
    .update('\0')
    .update(JSON.stringify(report.drift))
    .update('\0')
    .update(endpoints.join('\0'))
    .update('\0')
    .update(scopeKeys.join('\0'))
    .digest('hex')
}

function replayFor(report: RehearsalReport, aliases: string[]): RehearsalReviewReplay | undefined {
  const drift = report.drift.find((item) => aliases.includes(item.reference))
  if (!drift) return undefined
  return {
    reference: drift.reference,
    changed: drift.replay.changed,
    dropped: drift.replay.dropped,
    added: drift.replay.added,
    compared: drift.replay.compared
  }
}

function scopeKey(before: string | null, after: string | null): string {
  return `${before ?? ''}\0${after ?? ''}`
}

function scopeIdFor(reference: string, before: string | null, after: string | null): string {
  return createHash('sha256')
    .update('committed-reference\0')
    .update(reference)
    .update('\0')
    .update(before ?? '')
    .update('\0')
    .update(after ?? '')
    .digest('hex')
    .slice(0, 24)
}

function commitId(value: string | undefined, label: string): string | null {
  if (value === undefined) return null
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))
    throw new Error(`Frozen review ${label} endpoint is invalid. Refresh the result.`)
  return value
}

function endpoint(
  commit: string | null,
  report: RehearsalReport,
  before: boolean,
  kind: RehearsalReviewScopeKind = 'tracked-worktree'
): RehearsalReviewScope['before'] {
  if (!commit)
    return {
      kind: 'empty',
      commit: null,
      provenance: 'synthetic-empty'
    }
  const carried =
    kind === 'tracked-worktree' &&
    !!report.carried &&
    (before || report.carried.status === 'restored')
  return { kind: 'commit', commit, provenance: carried ? 'carried' : 'original' }
}

async function validateSandbox(report: RehearsalReport): Promise<string> {
  const root = await realpath(report.sandbox ?? '')
  const origin = await realpath(report.origin_worktree)
  if (!report.sandbox || inside(root, origin) || inside(origin, root))
    throw new Error('Frozen review requires a separate retained sandbox.')
  for (const option of ['--absolute-git-dir', '--git-common-dir']) {
    const directory = await realpath(
      (await runGit(root, ['rev-parse', '--path-format=absolute', option])).trim()
    )
    if (!inside(root, directory)) throw new Error('Sandbox Git metadata must be isolated.')
  }
  return root
}

function parseRawDiff(output: string): RawEntry[] {
  const tokens = output.split('\0')
  const entries: RawEntry[] = []
  for (let i = 0; i < tokens.length;) {
    const header = tokens[i++]
    if (!header) continue
    if (!header.startsWith(':')) continue
    const fields = header.slice(1).trim().split(/\s+/)
    if (fields.length < 5) continue
    const [oldMode, newMode, oldId, newId, status] = fields
    const first = tokens[i++] ?? ''
    const renamed = status.startsWith('R') || status.startsWith('C')
    const second = renamed ? (tokens[i++] ?? '') : first
    entries.push({
      oldMode,
      newMode,
      oldId,
      newId,
      status,
      oldPath: status[0] === 'A' ? null : first,
      newPath: status[0] === 'D' ? null : renamed ? second : first
    })
  }
  return entries
}

async function rawDiff(
  root: string,
  before: string | null,
  after: string | null,
  detectRenames: boolean
): Promise<RawEntry[]> {
  if (!before && !after) return []
  const emptyTree = before && after ? null : await emptyTreeObject(root)
  const output = await runGit(root, [
    '--no-replace-objects',
    '-c',
    'core.quotepath=false',
    'diff-tree',
    '--no-ext-diff',
    '--no-textconv',
    detectRenames ? '--find-renames=50%' : '--no-renames',
    '-r',
    '--raw',
    '-z',
    before ?? emptyTree!,
    after ?? emptyTree!,
    '--'
  ])
  return parseRawDiff(output)
}

/** Resolve the empty tree in the repository's object format (SHA-1 or SHA-256). */
async function emptyTreeObject(root: string): Promise<string> {
  const result = await runGitResult(
    root,
    ['--no-replace-objects', 'hash-object', '-t', 'tree', '--stdin'],
    { input: '' }
  )
  const object = result.stdout.trim()
  if (result.code !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(object))
    throw new Error('Frozen review could not resolve the repository empty tree.')
  return object
}

function side(mode: string, objectId: string): RehearsalReviewEntry['old'] {
  const present = !/^0+$/.test(objectId)
  return { present, mode: present ? mode : null, objectId: present ? objectId : null }
}

function entryType(
  oldMode: string,
  newMode: string,
  binary: boolean
): RehearsalReviewEntry['type'] {
  const mode = newMode !== '000000' ? newMode : oldMode
  if (mode === '120000') return 'symlink'
  if (mode === '160000') return 'gitlink'
  if (binary) return 'binary'
  if (oldMode !== newMode) return 'mode'
  return 'text'
}

function linesOf(text: string): number {
  if (text.length === 0) return 0
  const lines = text.split(/\r?\n/)
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

async function blobText(
  root: string,
  objectId: string | null,
  mode: string | null
): Promise<BlobText> {
  if (!objectId || !mode) return { kind: 'missing' }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(objectId)) return { kind: 'missing' }
  if (mode === '160000') return { kind: 'pointer', text: objectId, lines: 1 }
  const size = Number(
    (await runGit(root, ['--no-replace-objects', 'cat-file', '-s', objectId])).trim()
  )
  if (!Number.isSafeInteger(size) || size < 0) return { kind: 'missing' }
  if (size > REHEARSAL_REVIEW_BLOB_LIMIT) return { kind: 'too-large' }
  const bytes = await runGitBuffer(
    root,
    ['--no-replace-objects', 'cat-file', 'blob', objectId],
    REHEARSAL_REVIEW_BLOB_LIMIT
  )
  if (!bytes) return { kind: 'missing' }
  if (bytes.includes(0)) return { kind: 'binary' }
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) return { kind: 'binary' }
  return { kind: 'text', text, lines: linesOf(text) }
}

function availability(value: BlobText, present: boolean): RehearsalReviewAvailability {
  if (!present) return 'absent'
  if (value.kind === 'text') return 'available'
  if (value.kind === 'pointer') return 'available'
  if (value.kind === 'binary') return 'binary'
  if (value.kind === 'too-large') return 'too-large'
  return 'unavailable'
}

function contentText(value: BlobText): string | null {
  return value.kind === 'text' || value.kind === 'pointer' ? value.text : null
}

function textDiff(
  before: string,
  after: string
): { hunks: DiffHunk[]; additions: number; deletions: number; tooLarge: boolean } {
  if (before === after) return { hunks: [], additions: 0, deletions: 0, tooLarge: false }
  const oldLines = before.length ? before.split(/\r?\n/) : []
  const newLines = after.length ? after.split(/\r?\n/) : []
  if (oldLines.at(-1) === '') oldLines.pop()
  if (newLines.at(-1) === '') newLines.pop()
  const lines: DiffLine[] = [
    ...oldLines.map((text) => ({ kind: 'del' as const, text })),
    ...newLines.map((text) => ({ kind: 'add' as const, text }))
  ]
  const hunk = {
    header: `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    lines
  }
  const patchBytes =
    Buffer.byteLength(hunk.header) +
    lines.reduce((size, line) => size + Buffer.byteLength(line.text) + 2, 0)
  return {
    hunks: patchBytes > REHEARSAL_REVIEW_PATCH_LIMIT ? [] : [hunk],
    additions: newLines.length,
    deletions: oldLines.length,
    tooLarge: patchBytes > REHEARSAL_REVIEW_PATCH_LIMIT
  }
}

async function makeEntry(
  root: string,
  scopeId: string,
  raw: RawEntry,
  renameDetectionLimited = false
): Promise<RehearsalReviewEntry> {
  const old = side(raw.oldMode, raw.oldId)
  const newer = side(raw.newMode, raw.newId)
  const oldText = await blobText(root, old.objectId, old.mode)
  const newText = await blobText(root, newer.objectId, newer.mode)
  const binary = oldText.kind === 'binary' || newText.kind === 'binary'
  const type = entryType(raw.oldMode, raw.newMode, binary)
  const oldAvailable = availability(oldText, old.present)
  const newAvailable = availability(newText, newer.present)
  const oldContent = contentText(oldText)
  const newContent = contentText(newText)
  const sameText = oldContent !== null && newContent !== null && oldContent === newContent
  const modeOnly =
    sameText && raw.oldMode !== raw.newMode && oldContent !== null && newContent !== null
  const baseChanges = binary
    ? 'binary'
    : modeOnly
      ? 'mode-only'
      : oldText.kind === 'too-large' || newText.kind === 'too-large'
        ? 'too-large'
        : oldContent !== null || newContent !== null
          ? 'available'
          : 'unavailable'
  const key = createHash('sha256')
    .update(scopeId)
    .update('\0')
    .update(raw.oldPath ?? '')
    .update('\0')
    .update(raw.newPath ?? '')
    .update('\0')
    .update(raw.oldId)
    .update('\0')
    .update(raw.newId)
    .digest('hex')
  const diff = oldContent !== null && newContent !== null ? textDiff(oldContent, newContent) : null
  const changes = diff?.tooLarge ? 'too-large' : baseChanges
  const change =
    raw.status[0] === 'A'
      ? 'added'
      : raw.status[0] === 'D'
        ? 'deleted'
        : raw.status.startsWith('R') || raw.status.startsWith('C')
          ? 'renamed'
          : raw.oldMode !== raw.newMode && raw.oldId === raw.newId
            ? 'typechange'
            : 'modified'
  const rename =
    raw.status.startsWith('R') || raw.status.startsWith('C')
      ? 'detected'
      : raw.status[0] === 'A' || raw.status[0] === 'D'
        ? renameDetectionLimited
          ? 'limited'
          : 'not-applicable'
        : 'not-detected'
  return {
    entryId: key,
    change,
    oldPath: raw.oldPath,
    newPath: raw.newPath,
    old,
    new: newer,
    binary,
    type,
    rename,
    text: { changes, before: oldAvailable, after: newAvailable },
    lines: {
      before: oldContent !== null ? linesOf(oldContent) : null,
      after: newContent !== null ? linesOf(newContent) : null,
      additions: diff && !diff.tooLarge ? diff.additions : null,
      deletions: diff && !diff.tooLarge ? diff.deletions : null
    }
  }
}

async function readReport(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<RehearsalReport> {
  const result = await rehearsalShow(tool, identity)
  if (result.kind !== 'report') throw new Error(result.message)
  return result.report
}

async function mapBounded<T, R>(
  values: T[],
  map: (value: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++
      if (index >= values.length) return
      results[index] = await map(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

async function inventoryRaw(
  root: string,
  before: string | null,
  after: string | null
): Promise<{ entries: RawEntry[]; renameLimited: boolean }> {
  const complete = await rawDiff(root, before, after, false)
  if (complete.length > RENAME_DETECTION_ENTRY_LIMIT)
    return { entries: complete, renameLimited: true }
  try {
    return { entries: await rawDiff(root, before, after, true), renameLimited: false }
  } catch {
    return { entries: complete, renameLimited: true }
  }
}

async function retainedCommitAvailable(root: string, commit: string | null): Promise<boolean> {
  if (!commit) return true
  try {
    await runGit(root, ['--no-replace-objects', 'cat-file', '-e', `${commit}^{commit}`])
    return true
  } catch {
    return false
  }
}

function referenceScopes(report: RehearsalReport): Array<{
  aliases: string[]
  before: string | null
  after: string | null
}> {
  const currentAliases = new Set(['HEAD'])
  if (report.checkout.kind === 'branch' && report.checkout.target)
    currentAliases.add(`refs/heads/${report.checkout.target}`)
  const groups = new Map<
    string,
    { aliases: string[]; before: string | null; after: string | null }
  >()
  for (const ref of report.refs) {
    const before = commitId(ref.before, `${ref.name} before`)
    const after = commitId(ref.after, `${ref.name} after`)
    if (!before && !after) continue
    const key = currentAliases.has(ref.name)
      ? `current\0${scopeKey(before, after)}`
      : `ref\0${ref.name}\0${scopeKey(before, after)}`
    const group = groups.get(key) ?? { aliases: [], before, after }
    group.aliases.push(ref.name)
    groups.set(key, group)
  }
  return [...groups.values()].filter(
    (group) =>
      group.aliases.some((alias) => alias !== 'HEAD') ||
      (report.checkout.kind === 'detached' && group.aliases.includes('HEAD'))
  )
}

async function loadData(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<ReviewData> {
  const report = await readReport(tool, identity)
  const root = await validateSandbox(report)
  const endpoints = await resolveRehearsalEndpoints(report)
  const additional = referenceScopes(report)
  const additionalKeys = additional.map(
    (group) => `${group.aliases.join(',')}\0${group.before ?? ''}\0${group.after ?? ''}`
  )
  const revision = revisionOf(report, endpoints, additionalKeys)
  const before = endpoints[0]
  const after = endpoints[1] ?? null
  const scope: RehearsalReviewScope = {
    scopeId: 'tracked-worktree',
    kind: 'tracked-worktree',
    label: 'Tracked worktree result',
    refAliases: ['HEAD'],
    before: endpoint(before, report, true),
    after: after ? endpoint(after, report, false) : null,
    available: true,
    unavailableReason: after ? undefined : 'This rehearsal has no finished After endpoint.',
    replay: replayFor(report, ['HEAD']),
    renameDetectionLimited: false
  }
  const scopes: ScopeData[] = []
  const defaultEndpointsAvailable =
    (await retainedCommitAvailable(root, before)) && (await retainedCommitAvailable(root, after))
  scope.available = defaultEndpointsAvailable
  if (!defaultEndpointsAvailable)
    scope.unavailableReason =
      'A retained worktree endpoint is unavailable; this scope was not replaced with a live reference.'
  const defaultRaw = defaultEndpointsAvailable
    ? await inventoryRaw(root, before, after)
    : { entries: [], renameLimited: false }
  scope.renameDetectionLimited = defaultRaw.renameLimited
  const entries = await mapBounded(
    defaultRaw.entries,
    (item) => makeEntry(root, scope.scopeId, item, defaultRaw.renameLimited),
    BLOB_READ_CONCURRENCY
  )
  scopes.push({ scope, entries })
  for (const group of additional) {
    const aliases = [...group.aliases].sort()
    const id = scopeIdFor(aliases[0], group.before, group.after)
    const replay = replayFor(report, aliases)
    const committedScope: RehearsalReviewScope = {
      scopeId: id,
      kind: 'committed-reference',
      label: `Reference ${aliases.join(', ')}`,
      refAliases: aliases,
      before: endpoint(group.before, report, true, 'committed-reference'),
      after: group.after
        ? endpoint(group.after, report, false, 'committed-reference')
        : endpoint(null, report, false, 'committed-reference'),
      available: true,
      replay,
      renameDetectionLimited: false
    }
    const endpointsAvailable =
      (await retainedCommitAvailable(root, group.before)) &&
      (await retainedCommitAvailable(root, group.after))
    committedScope.available = endpointsAvailable
    if (!endpointsAvailable)
      committedScope.unavailableReason =
        'A retained reference object is unavailable; this scope was not replaced with a live reference.'
    const raw = endpointsAvailable
      ? await inventoryRaw(root, group.before, group.after)
      : { entries: [], renameLimited: false }
    committedScope.renameDetectionLimited = raw.renameLimited
    const committedEntries = await mapBounded(
      raw.entries,
      (item) => makeEntry(root, id, item, raw.renameLimited),
      BLOB_READ_CONCURRENCY
    )
    scopes.push({ scope: committedScope, entries: committedEntries })
  }
  const current = await readReport(tool, identity)
  const currentRoot = await validateSandbox(current)
  const currentEndpoints = await resolveRehearsalEndpoints(current)
  if (
    rehearsalComparisonKey(current) !== rehearsalComparisonKey(report) ||
    JSON.stringify(current.drift) !== JSON.stringify(report.drift) ||
    currentEndpoints.join('\0') !== endpoints.join('\0') ||
    currentRoot !== root
  )
    throw new Error('Rehearsal changed during review. Refresh the result.')
  return {
    report,
    identity: identityOf(report),
    revision,
    scope,
    entries,
    root,
    scopes: new Map(scopes.map((item) => [item.scope.scopeId, item]))
  }
}

function decodeCursor(
  cursor: string | undefined,
  revision: string,
  scopeId: string,
  filter: string
): number {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      revision: string
      scopeId: string
      filter: string
      offset: number
    }
    if (
      value.revision !== revision ||
      value.scopeId !== scopeId ||
      value.filter !== filter ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0
    )
      throw new Error('The review inventory cursor is stale. Refresh the file list.')
    return value.offset
  } catch (error) {
    if (error instanceof Error && error.message.includes('stale')) throw error
    throw new Error('The review inventory cursor is invalid. Refresh the file list.')
  }
}

function encodeCursor(revision: string, scopeId: string, filter: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, scopeId, filter, offset })).toString('base64url')
}

export async function rehearsalReviewSummary(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<RehearsalReviewSummary> {
  return withRehearsal(identity, async () => {
    const data = await loadData(tool, identity)
    const complete =
      data.report.outcome === 'clean' && data.scope.after !== null && data.scope.available
    const notices = [
      'Review reads use retained Git objects. Live worktree edits are excluded.',
      'Untracked files and the original staging selection are excluded from this tracked-worktree scope.'
    ]
    if (!complete)
      notices.push('After is withheld until the rehearsal has a finished, conflict-free result.')
    if ([...data.scopes.values()].some((item) => item.scope.renameDetectionLimited))
      notices.push(
        'Rename detection was bounded for a large change set; complete add/delete entries remain visible.'
      )
    return {
      identity: data.identity,
      reviewRevision: data.revision,
      toolResultRevision: null,
      complete,
      afterAvailable: data.scope.available && data.scope.after?.kind === 'commit',
      afterReason:
        data.scope.available && data.scope.after?.kind === 'commit'
          ? null
          : (data.scope.unavailableReason ?? 'No finished After endpoint is available.'),
      scopes: [...data.scopes.values()].map((item) => item.scope),
      defaultScopeId: data.scope.scopeId,
      notices,
      replayWarnings: data.report.drift.map((drift) => ({
        reference: drift.reference,
        changed: drift.replay.changed,
        dropped: drift.replay.dropped,
        added: drift.replay.added,
        compared: drift.replay.compared
      })),
      carried: data.report.carried
        ? {
            status: data.report.carried.status,
            paths: data.report.carried.paths,
            included:
              ['restored', 'contained', 'not_needed'].includes(data.report.carried.status) &&
              data.report.carried.conflicts.length === 0,
            reason: data.report.carried.reason
          }
        : null
    }
  })
}

export async function rehearsalReviewFiles(
  tool: string | undefined,
  identity: RehearsalIdentity,
  reviewRevision: string,
  scopeId: string,
  cursor?: string,
  filter?: string
): Promise<RehearsalReviewFilesResult> {
  return withRehearsal(identity, async () => {
    const data = await loadData(tool, identity)
    if (data.revision !== reviewRevision)
      throw new Error('Review result changed. Refresh the summary.')
    const selectedScope = data.scopes.get(scopeId)
    if (!selectedScope) throw new Error('Review scope is unavailable. Refresh the summary.')
    if (
      data.report.outcome !== 'clean' ||
      selectedScope.scope.after === null ||
      !selectedScope.scope.available
    )
      return {
        identity: data.identity,
        reviewRevision,
        scopeId,
        entries: [],
        nextCursor: null,
        total: null,
        complete: false,
        filter: null
      }
    const needle = (filter ?? '').trim().toLocaleLowerCase()
    const all = needle
      ? selectedScope.entries.filter((entry) =>
          `${entry.oldPath ?? ''}\n${entry.newPath ?? ''}`.toLocaleLowerCase().includes(needle)
        )
      : selectedScope.entries
    const offset = decodeCursor(cursor, reviewRevision, scopeId, needle)
    const entries = all.slice(offset, offset + REHEARSAL_REVIEW_PAGE_SIZE)
    const nextCursor =
      offset + entries.length < all.length
        ? encodeCursor(reviewRevision, scopeId, needle, offset + entries.length)
        : null
    return {
      identity: data.identity,
      reviewRevision,
      scopeId,
      entries,
      nextCursor,
      total: all.length,
      complete: true,
      filter: needle || null
    }
  })
}

export async function rehearsalReviewFile(
  tool: string | undefined,
  identity: RehearsalIdentity,
  reviewRevision: string,
  scopeId: string,
  entryId: string,
  view: RehearsalReviewFileView
): Promise<RehearsalReviewFileResult> {
  return withRehearsal(identity, async () => {
    if (!['changes', 'before', 'after'].includes(view))
      throw new Error('Choose a valid review view.')
    const data = await loadData(tool, identity)
    if (data.revision !== reviewRevision)
      throw new Error('Review result changed. Refresh the summary.')
    const selectedScope = data.scopes.get(scopeId)
    if (!selectedScope) throw new Error('Review scope is unavailable. Refresh the summary.')
    const entry = selectedScope.entries.find((candidate) => candidate.entryId === entryId)
    if (!entry) throw new Error('Review file is unavailable. Refresh the file list.')
    const before = await blobText(data.root, entry.old.objectId, entry.old.mode)
    const after = await blobText(data.root, entry.new.objectId, entry.new.mode)
    let availability: RehearsalReviewAvailability
    let text: string | null = null
    let hunks: DiffHunk[] = []
    if (view === 'before') {
      availability = availabilityOf(before, entry.old.present)
      text = contentText(before)
    } else if (view === 'after') {
      availability =
        selectedScope.scope.after?.kind === 'commit'
          ? availabilityOf(after, entry.new.present)
          : entry.new.present
            ? 'unavailable'
            : 'absent'
      if (selectedScope.scope.after?.kind === 'commit') text = contentText(after)
    } else if (entry.text.changes === 'mode-only') {
      availability = 'mode-only'
    } else if (contentText(before) !== null && contentText(after) !== null) {
      const diff = textDiff(contentText(before)!, contentText(after)!)
      availability = diff.tooLarge ? 'too-large' : 'available'
      hunks = diff.hunks
    } else {
      availability = entry.text.changes
    }
    return {
      identity: data.identity,
      reviewRevision,
      scopeId,
      entryId,
      view,
      availability,
      text,
      hunks,
      entry
    }
  })
}

function availabilityOf(value: BlobText, present: boolean): RehearsalReviewAvailability {
  return availability(value, present)
}
