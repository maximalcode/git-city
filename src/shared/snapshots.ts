import type { CompactSnapshot, FileState, RepoAnalysis, Snapshot } from './types'

/**
 * The columnar snapshot format (#62): building it, reading it back, and the
 * whole-history passes that used to force every snapshot into object form.
 *
 * The analysis holds ~50 sampled captures of the entire repo. As one
 * FileState object per file per capture that is >500 MB resident on a
 * monorepo — and it exists twice, once in the main-process cache and once in
 * the renderer. As parallel typed arrays the same data is ~25 bytes per entry,
 * and only the capture actually being viewed is ever materialized back into
 * objects.
 *
 * Shared between main and renderer because both ends need it: the analyzer
 * compacts as it streams, the incremental path re-seeds from the last capture,
 * and the renderer materializes the current timeline position.
 */

/** Grow-only string tables; ids stay valid for the life of an analysis. */
export interface Interner {
  paths: string[]
  authors: string[]
  pathIds: Map<string, number>
  authorIds: Map<string, number>
}

/**
 * Start interning, optionally on top of an existing analysis's tables (the
 * incremental path). Appends mutate the given arrays — that is safe and
 * deliberate: ids are append-only, so older snapshots keep resolving.
 */
export function createInterner(paths: string[] = [], authors: string[] = []): Interner {
  return {
    paths,
    authors,
    pathIds: new Map(paths.map((p, i) => [p, i])),
    authorIds: new Map(authors.map((a, i) => [a, i]))
  }
}

function intern(table: string[], ids: Map<string, number>, value: string): number {
  let id = ids.get(value)
  if (id === undefined) {
    id = table.length
    table.push(value)
    ids.set(value, id)
  }
  return id
}

export interface SnapshotMeta {
  hash: string
  date: number
  author: string
  message: string
  index: number
}

/**
 * Columnize one capture. `count` is passed rather than derived so callers can
 * hand over a Map's live values() without first copying them into an array —
 * the copy is exactly the allocation this format exists to avoid.
 */
export function compactSnapshot(
  interner: Interner,
  meta: SnapshotMeta,
  files: Iterable<FileState>,
  count: number
): CompactSnapshot {
  const pathId = new Uint32Array(count)
  const loc = new Uint32Array(count)
  const commits = new Uint32Array(count)
  const lastTouched = new Float64Array(count)
  const authorId = new Uint32Array(count)
  const binary = new Uint8Array(count)
  let i = 0
  for (const f of files) {
    pathId[i] = intern(interner.paths, interner.pathIds, f.path)
    loc[i] = f.loc
    commits[i] = f.commits
    lastTouched[i] = f.lastTouched
    authorId[i] = intern(interner.authors, interner.authorIds, f.lastAuthor)
    binary[i] = f.binary ? 1 : 0
    i++
  }
  return { ...meta, pathId, loc, commits, lastTouched, authorId, binary }
}

/** Rebuild the object form of one capture — the timeline position on screen. */
export function materializeSnapshot(analysis: RepoAnalysis, index: number): Snapshot {
  const s = analysis.snapshots[index]
  const n = s.pathId.length
  const files: FileState[] = new Array(n)
  for (let i = 0; i < n; i++) {
    files[i] = {
      path: analysis.paths[s.pathId[i]],
      loc: s.loc[i],
      commits: s.commits[i],
      lastTouched: s.lastTouched[i],
      lastAuthor: analysis.authors[s.authorId[i]],
      binary: s.binary[i] === 1
    }
  }
  return { hash: s.hash, date: s.date, author: s.author, message: s.message, index: s.index, files }
}

/**
 * Position of the value closest to `want`. Ties go to the earlier one, and an
 * empty list answers 0 rather than -1 — both callers are asking "which of the
 * commits we captured is nearest to this one", and want an answer they can use
 * without a second branch.
 */
export function nearestPosition(values: number[], want: number): number {
  let best = 0
  let bestGap = Infinity
  for (let i = 0; i < values.length; i++) {
    const gap = Math.abs(values[i] - want)
    if (gap < bestGap) {
      best = i
      bestGap = gap
    }
  }
  return best
}

/**
 * Array position of the capture closest to a commit index.
 *
 * Snapshots are a sample of history, and re-sampling on splice (#71) moves
 * where the stops fall — so "the position the user was looking at" cannot be
 * carried across an analysis as an array index. The commit index survives;
 * this maps it back.
 */
export function snapshotAtCommit(analysis: RepoAnalysis, commitIndex: number): number {
  return nearestPosition(
    analysis.snapshots.map((s) => s.index),
    commitIndex
  )
}

/**
 * Peak line count per path across the whole history — the union pass the
 * city and farm layouts are built from, straight off the columns so no
 * snapshot has to be materialized for it.
 *
 * Only paths that ever existed appear as keys (a path present with 0 lines
 * still counts as existing).
 */
export function peakLocByPath(analysis: RepoAnalysis): Map<string, number> {
  const peak = new Float64Array(analysis.paths.length).fill(-1)
  for (const s of analysis.snapshots) {
    for (let i = 0; i < s.pathId.length; i++) {
      const id = s.pathId[i]
      if (s.loc[i] > peak[id]) peak[id] = s.loc[i]
    }
  }
  const out = new Map<string, number>()
  for (let id = 0; id < peak.length; id++) {
    if (peak[id] >= 0) out.set(analysis.paths[id], peak[id])
  }
  return out
}

/**
 * Convert object-form snapshots into a full analysis. This is the fixture and
 * mock path — production analysis compacts while streaming and never holds
 * more than one commit's state in object form.
 */
export function buildAnalysis(info: RepoAnalysis['info'], snapshots: Snapshot[]): RepoAnalysis {
  const interner = createInterner()
  return {
    info,
    paths: interner.paths,
    authors: interner.authors,
    snapshots: snapshots.map((s) =>
      compactSnapshot(
        interner,
        { hash: s.hash, date: s.date, author: s.author, message: s.message, index: s.index },
        s.files,
        s.files.length
      )
    )
  }
}

/**
 * Resident bytes of the analysis's bulk data: column buffers plus the interned
 * strings (UTF-16, so 2 bytes per char). Metadata strings are ignored — ~50
 * commit messages are noise next to millions of file entries. This is what
 * the perf harness reports, so the number in #62 stays measurable.
 */
export function analysisBytes(analysis: RepoAnalysis): number {
  let bytes = 0
  for (const s of analysis.snapshots) {
    bytes +=
      s.pathId.byteLength +
      s.loc.byteLength +
      s.commits.byteLength +
      s.lastTouched.byteLength +
      s.authorId.byteLength +
      s.binary.byteLength
  }
  for (const p of analysis.paths) bytes += p.length * 2
  for (const a of analysis.authors) bytes += a.length * 2
  return bytes
}
