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
  RehearsalReviewSummary
} from '../shared/types'
import { rehearsalComparisonKey } from '../shared/rehearsalComparison'
import { runGit, runGitBuffer } from './git/exec'
import { rehearsalShow } from './rehearsal'
import { resolveRehearsalEndpoints } from './rehearsalComparison'
import { withRehearsal } from './rehearsalConflicts'

const MAX_CONTENT_BYTES = 4 * 1024 * 1024
const PAGE_SIZE = 100

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
}

function identityOf(report: RehearsalReport): RehearsalIdentity {
  return {
    id: report.id,
    repository: report.repository,
    repository_id: report.repository_id,
    origin_worktree: report.origin_worktree
  }
}

function revisionOf(report: RehearsalReport, endpoints: string[]): string {
  return createHash('sha256')
    .update(rehearsalComparisonKey(report))
    .update('\0')
    .update(endpoints.join('\0'))
    .digest('hex')
}

function endpoint(
  commit: string,
  report: RehearsalReport,
  before: boolean
): RehearsalReviewScope['before'] {
  const carried = !!report.carried && (before || report.carried.status === 'restored')
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

async function rawDiff(root: string, before: string, after: string): Promise<RawEntry[]> {
  const output = await runGit(root, [
    '--no-replace-objects',
    '-c',
    'core.quotepath=false',
    'diff-tree',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '-r',
    '--raw',
    '-z',
    before,
    after,
    '--'
  ])
  return parseRawDiff(output)
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
  if (!objectId || !mode || mode === '120000' || mode === '160000') return { kind: 'missing' }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(objectId)) return { kind: 'missing' }
  const size = Number(
    (await runGit(root, ['--no-replace-objects', 'cat-file', '-s', objectId])).trim()
  )
  if (!Number.isSafeInteger(size) || size < 0) return { kind: 'missing' }
  if (size > MAX_CONTENT_BYTES) return { kind: 'too-large' }
  const bytes = await runGitBuffer(
    root,
    ['--no-replace-objects', 'cat-file', 'blob', objectId],
    MAX_CONTENT_BYTES
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
  if (value.kind === 'binary') return 'binary'
  if (value.kind === 'too-large') return 'too-large'
  return 'unavailable'
}

function textDiff(
  before: string,
  after: string
): { hunks: DiffHunk[]; additions: number; deletions: number } {
  if (before === after) return { hunks: [], additions: 0, deletions: 0 }
  const oldLines = before.length ? before.split(/\r?\n/) : []
  const newLines = after.length ? after.split(/\r?\n/) : []
  if (oldLines.at(-1) === '') oldLines.pop()
  if (newLines.at(-1) === '') newLines.pop()
  const lines: DiffLine[] = [
    ...oldLines.map((text) => ({ kind: 'del' as const, text })),
    ...newLines.map((text) => ({ kind: 'add' as const, text }))
  ]
  return {
    hunks: [
      {
        header: `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
        lines
      }
    ],
    additions: newLines.length,
    deletions: oldLines.length
  }
}

async function makeEntry(
  root: string,
  scopeId: string,
  raw: RawEntry
): Promise<RehearsalReviewEntry> {
  const old = side(raw.oldMode, raw.oldId)
  const newer = side(raw.newMode, raw.newId)
  const oldText = await blobText(root, old.objectId, old.mode)
  const newText = await blobText(root, newer.objectId, newer.mode)
  const binary = oldText.kind === 'binary' || newText.kind === 'binary'
  const type = entryType(raw.oldMode, raw.newMode, binary)
  const oldAvailable = availability(oldText, old.present)
  const newAvailable = availability(newText, newer.present)
  const sameText =
    oldText.kind === 'text' && newText.kind === 'text' && oldText.text === newText.text
  const modeOnly =
    sameText &&
    raw.oldMode !== raw.newMode &&
    oldText.kind === 'text' &&
    newText.kind === 'text' &&
    oldText.text === newText.text
  const changes = binary
    ? 'binary'
    : type === 'symlink' || type === 'gitlink'
      ? 'unavailable'
      : modeOnly
        ? 'mode-only'
        : oldText.kind === 'too-large' || newText.kind === 'too-large'
          ? 'too-large'
          : oldText.kind === 'text' || newText.kind === 'text'
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
  const diff =
    oldText.kind === 'text' && newText.kind === 'text'
      ? textDiff(oldText.text, newText.text)
      : { additions: null, deletions: null }
  return {
    entryId: key,
    change:
      raw.status[0] === 'A'
        ? 'added'
        : raw.status[0] === 'D'
          ? 'deleted'
          : raw.oldMode !== raw.newMode && raw.oldId === raw.newId
            ? 'typechange'
            : 'modified',
    oldPath: raw.oldPath,
    newPath: raw.newPath,
    old,
    new: newer,
    binary,
    type,
    text: { changes, before: oldAvailable, after: newAvailable },
    lines: {
      before: oldText.kind === 'text' ? oldText.lines : null,
      after: newText.kind === 'text' ? newText.lines : null,
      additions: diff.additions,
      deletions: diff.deletions
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

async function loadData(
  tool: string | undefined,
  identity: RehearsalIdentity
): Promise<ReviewData> {
  const report = await readReport(tool, identity)
  const root = await validateSandbox(report)
  const endpoints = await resolveRehearsalEndpoints(report)
  const revision = revisionOf(report, endpoints)
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
    unavailableReason: after ? undefined : 'This rehearsal has no finished After endpoint.'
  }
  const raw = after ? await rawDiff(root, before, after) : []
  const entries = await Promise.all(raw.map((item) => makeEntry(root, scope.scopeId, item)))
  const current = await readReport(tool, identity)
  const currentRoot = await validateSandbox(current)
  const currentEndpoints = await resolveRehearsalEndpoints(current)
  if (
    rehearsalComparisonKey(current) !== rehearsalComparisonKey(report) ||
    currentEndpoints.join('\0') !== endpoints.join('\0') ||
    currentRoot !== root
  )
    throw new Error('Rehearsal changed during review. Refresh the result.')
  return { report, identity: identityOf(report), revision, scope, entries, root }
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
    const complete = data.report.outcome === 'clean' && data.scope.after !== null
    const notices = [
      'Review reads use retained Git objects. Live worktree edits are excluded.',
      'Untracked files and the original staging selection are excluded from this tracked-worktree scope.'
    ]
    if (!complete)
      notices.push('After is withheld until the rehearsal has a finished, conflict-free result.')
    return {
      identity: data.identity,
      reviewRevision: data.revision,
      toolResultRevision: null,
      complete,
      afterAvailable: data.scope.after !== null,
      afterReason: data.scope.after ? null : 'No finished After endpoint is available.',
      scopes: [data.scope],
      defaultScopeId: data.scope.scopeId,
      notices,
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
    if (data.scope.scopeId !== scopeId)
      throw new Error('Review scope is unavailable. Refresh the summary.')
    if (data.report.outcome !== 'clean' || data.scope.after === null)
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
      ? data.entries.filter((entry) =>
          `${entry.oldPath ?? ''}\n${entry.newPath ?? ''}`.toLocaleLowerCase().includes(needle)
        )
      : data.entries
    const offset = decodeCursor(cursor, reviewRevision, scopeId, needle)
    const entries = all.slice(offset, offset + PAGE_SIZE)
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
    if (data.scope.scopeId !== scopeId)
      throw new Error('Review scope is unavailable. Refresh the summary.')
    const entry = data.entries.find((candidate) => candidate.entryId === entryId)
    if (!entry) throw new Error('Review file is unavailable. Refresh the file list.')
    const before = await blobText(data.root, entry.old.objectId, entry.old.mode)
    const after = await blobText(data.root, entry.new.objectId, entry.new.mode)
    let availability: RehearsalReviewAvailability
    let text: string | null = null
    let hunks: DiffHunk[] = []
    if (view === 'before') {
      availability = availabilityOf(before, entry.old.present)
      if (before.kind === 'text') text = before.text
    } else if (view === 'after') {
      availability = data.scope.after ? availabilityOf(after, entry.new.present) : 'unavailable'
      if (data.scope.after && after.kind === 'text') text = after.text
    } else if (entry.text.changes === 'mode-only') {
      availability = 'mode-only'
    } else if (before.kind === 'text' && after.kind === 'text') {
      availability = 'available'
      hunks = textDiff(before.text, after.text).hunks
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
