import { basename } from 'path'
import type {
  CompactSnapshot,
  FileState,
  GitVersion,
  ProgressInfo,
  RepoAnalysis,
  RepoSize
} from '../../shared/types'
import {
  compactSnapshot,
  createInterner,
  materializeSnapshot,
  nearestPosition,
  type Interner
} from '../../shared/snapshots'
import { runGit, runGitLines, runGitResult } from './exec'
import { FriendlyError } from './result'
import { describeGitVersion } from '../../shared/gitVersion'
import { BARE_REPOSITORY, gitComplaint, INSIDE_GIT_DIR, NOT_A_REPOSITORY } from './openErrors'

/**
 * Repo analysis built from a single streaming pass of
 * `git log --first-parent --reverse --no-renames --raw --numstat`.
 *
 * Along first-parent history each commit's diff is against the previous
 * mainline state, so the diffs telescope: cumulatively applying added/deleted
 * line counts reproduces the exact line count of every file at every mainline
 * commit — no checkouts or per-commit file reads needed.
 */

const SENTINEL = '\x01'

/**
 * Ask the git on PATH what it is. null means there isn't one — the renderer
 * distinguishes that (install git) from a version we can't work with (update
 * git), because they are different instructions.
 */
export async function checkGitInstalled(): Promise<GitVersion | null> {
  try {
    const v = await runGit(process.cwd(), ['--version'])
    return describeGitVersion(v.trim())
  } catch {
    return null
  }
}

/** Evenly spaced indices across [0, total), always including the last. */
export function pickSampleIndices(total: number, target: number): Set<number> {
  const picks = new Set<number>()
  if (total <= 0) return picks
  const n = Math.min(total, Math.max(2, target))
  for (let i = 0; i < n; i++) {
    picks.add(Math.round((i * (total - 1)) / (n - 1)))
  }
  picks.add(total - 1)
  return picks
}

/**
 * Where a spliced analysis should keep its captures.
 *
 * pickSampleIndices says where the stops belong for the new commit count, but
 * the old region can only offer indices it already captured — not re-reading
 * that history is the entire point of splicing. So every ideal stop below
 * `firstNew` snaps to the nearest index we actually hold, while stops at or
 * above it are taken as-is: those commits are about to be replayed and can be
 * captured wherever we like.
 *
 * Without this the splice appended a capture per new commit and dropped none,
 * so the timeline ratcheted — 200 stops where a full analysis has 50, the
 * scrubber's last quarter covering a third of history, and it never came back
 * down (#71).
 *
 * Dropping captures also drops what they contributed to peakLocByPath, so a
 * building's footprint can change across a splice. That is the same thing a
 * full analysis does with the same sample set — converging on it is the point.
 */
export function resampleIndices(
  existing: number[],
  firstNew: number,
  total: number,
  target: number
): Set<number> {
  const keep = new Set<number>()
  for (const want of pickSampleIndices(total, target)) {
    if (want >= firstNew) {
      keep.add(want)
    } else if (existing.length > 0) {
      keep.add(existing[nearestPosition(existing, want)])
    }
  }
  // The tip is what the *next* splice re-seeds its file state from, so it has
  // to survive the sampling. pickSampleIndices always includes it; this says so
  // where the invariant lives rather than relying on it from a distance.
  keep.add(total - 1)
  return keep
}

interface PendingCommit {
  hash: string
  date: number
  author: string
  message: string
  /** path → accumulated change within this commit */
  changes: Map<string, { add: number; del: number; deleted: boolean; binary: boolean }>
}

function unquotePath(p: string): string {
  // git quotes paths containing special characters as "..." with C escapes
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p) as string
    } catch {
      return p.slice(1, -1)
    }
  }
  return p
}

/**
 * Stream a first-parent log range and cumulatively apply it to `state`.
 * `startIndex` is the mainline index of the first commit in the range.
 * Returns the snapshots taken at indices approved by `shouldSnapshot`.
 */
async function replayRange(
  repoPath: string,
  range: string,
  state: Map<string, FileState>,
  interner: Interner,
  startIndex: number,
  shouldSnapshot: (index: number) => boolean,
  onCommitDone?: (index: number) => void
): Promise<CompactSnapshot[]> {
  const snapshots: CompactSnapshot[] = []
  let commitIndex = startIndex - 1
  let current: PendingCommit | null = null

  const finishCommit = (): void => {
    if (!current) return
    commitIndex++
    for (const [path, ch] of current.changes) {
      if (ch.deleted) {
        state.delete(path)
        continue
      }
      let f = state.get(path)
      if (!f) {
        f = { path, loc: 0, commits: 0, lastTouched: 0, lastAuthor: '', binary: false }
        state.set(path, f)
      }
      f.loc = Math.max(0, f.loc + ch.add - ch.del)
      f.commits++
      f.lastTouched = current.date
      f.lastAuthor = current.author
      if (ch.binary) f.binary = true
    }
    if (shouldSnapshot(commitIndex)) {
      // columnar capture straight off the live state — the object form of a
      // snapshot never exists here, which is the point of #62
      snapshots.push(
        compactSnapshot(
          interner,
          {
            hash: current.hash,
            date: current.date,
            author: current.author,
            message: current.message,
            index: commitIndex
          },
          state.values(),
          state.size
        )
      )
    }
    onCommitDone?.(commitIndex)
    current = null
  }

  const getChange = (
    c: PendingCommit,
    path: string
  ): { add: number; del: number; deleted: boolean; binary: boolean } => {
    let ch = c.changes.get(path)
    if (!ch) {
      ch = { add: 0, del: 0, deleted: false, binary: false }
      c.changes.set(path, ch)
    }
    return ch
  }

  await runGitLines(
    repoPath,
    [
      '-c',
      'core.quotepath=false',
      '-c',
      'diff.algorithm=myers',
      'log',
      '--first-parent',
      '--reverse',
      '--no-renames',
      '--raw',
      '--numstat',
      '--date=unix',
      `--format=${SENTINEL}%H%x09%at%x09%an%x09%s`,
      range
    ],
    (line) => {
      if (line.startsWith(SENTINEL)) {
        finishCommit()
        const [hash, at, author, ...rest] = line.slice(1).split('\t')
        current = {
          hash,
          date: parseInt(at, 10) * 1000,
          author,
          message: rest.join('\t'),
          changes: new Map()
        }
        return
      }
      if (!current || line.length === 0) return
      if (line.startsWith(':')) {
        // raw line: ":100644 000000 abc def D\tpath"
        const tab = line.indexOf('\t')
        if (tab === -1) return
        const status = line.slice(0, tab).split(' ').pop() ?? ''
        const path = unquotePath(line.slice(tab + 1))
        if (status.startsWith('D')) getChange(current, path).deleted = true
        return
      }
      // numstat line: "12\t3\tpath" or "-\t-\tbinary"
      const parts = line.split('\t')
      if (parts.length < 3) return
      const [addStr, delStr] = parts
      const path = unquotePath(parts.slice(2).join('\t'))
      const ch = getChange(current, path)
      if (addStr === '-' || delStr === '-') {
        ch.binary = true
      } else {
        ch.add += parseInt(addStr, 10) || 0
        ch.del += parseInt(delStr, 10) || 0
      }
    }
  )
  finishCommit()
  return snapshots
}

/**
 * Last full analysis per repo, kept so the next analyze() can splice new
 * commits without re-reading the whole history. Analyses are too big to
 * round-trip over IPC, so the renderer only ever asks by repoPath.
 *
 * The sample target rides along because the splice has to re-sample to it
 * (#71). analyze() owns the value now (#112) — one entry point, not an
 * argument of one path and hidden state of the other — and the cache records
 * the target the analysis it holds was actually built at, so a splice
 * continues at that same target. That continuation is deliberate: a splice
 * against a target change could only snap its new ideal stops onto captures
 * that already exist, so spacing would degrade until the next full replay,
 * which picks the new target up cleanly.
 *
 * Bounded, because analyses are big (every sampled commit's full file state)
 * and a session that opens many repositories should not hold all of them
 * forever (#74). Recency is bumped by every successful store — and every
 * successful analysis ends in one — so eviction is LRU in effect.
 */
interface CachedAnalysis {
  analysis: RepoAnalysis
  sampleTarget: number
}

const analysisCache = new Map<string, CachedAnalysis>()

/** How many repos' last analysis to keep. A splice for an evicted repo merely
 * costs a full re-read — never a wrong answer. */
const MAX_CACHED_REPOS = 4

/**
 * Drop the oldest entries until the map holds at most `max`. Map iteration is
 * insertion order and delete+set bumps an entry to newest, so the first key is
 * the least recently used. Exported for tests: the policy is the unit,
 * cacheAnalysis is just the wiring.
 */
export function evictOldest<V>(m: Map<string, V>, max: number): void {
  while (m.size > max) {
    const oldest = m.keys().next().value
    if (oldest === undefined) return
    m.delete(oldest)
  }
}

/** Record an analysis as the newest cache entry, evicting past the cap. */
function cacheAnalysis(repoPath: string, analysis: RepoAnalysis, sampleTarget: number): void {
  analysisCache.delete(repoPath)
  analysisCache.set(repoPath, { analysis, sampleTarget })
  evictOldest(analysisCache, MAX_CACHED_REPOS)
}

/**
 * Commit and file counts, cheaply — two counting calls, no history replay.
 *
 * The full analysis streams every commit's numstat, which on a monorepo runs
 * for minutes (see #12). This is what lets the UI say so up front instead of
 * leaving someone staring at a bar that looks stuck.
 */
export async function repoSize(repoPath: string): Promise<RepoSize> {
  let commits = 0
  try {
    commits = parseInt(
      (await runGit(repoPath, ['rev-list', '--count', '--first-parent', 'HEAD'])).trim(),
      10
    )
  } catch {
    commits = 0 // unborn HEAD
  }
  if (!Number.isFinite(commits)) commits = 0

  let files = 0
  try {
    const out = await runGit(repoPath, ['ls-files'])
    files = out.length === 0 ? 0 : out.trimEnd().split('\n').length
  } catch {
    files = 0
  }
  return { commits, files }
}

/**
 * `--is-inside-work-tree` said no. Ask git what the folder actually is before
 * telling the user it isn't a repository, because for a bare clone and for a
 * `.git` directory that answer is simply false (#25).
 *
 * Order matters: `--is-bare-repository` is true for both, so it has to be asked
 * first, and `--is-inside-git-dir` then separates the `.git` of a normal
 * checkout from a genuinely bare one.
 */
async function explainNotAWorkTree(repoPath: string, stderr: string): Promise<string> {
  const bare = await runGitResult(repoPath, ['rev-parse', '--is-bare-repository'])
  if (bare.stdout.trim() === 'true') return BARE_REPOSITORY

  const inGitDir = await runGitResult(repoPath, ['rev-parse', '--is-inside-git-dir'])
  if (inGitDir.stdout.trim() === 'true') return INSIDE_GIT_DIR

  // git's own words, when it had any — the dubious-ownership refusal carries
  // the exact command the user needs to run.
  return gitComplaint(stderr) ?? NOT_A_REPOSITORY
}

/**
 * The sample target every analysis is opened at. It used to travel as a
 * renderer argument plus a hidden module-level constant, spelled in three
 * places and smuggled through the cache (#75); one entry point owns it now.
 */
const DEFAULT_SAMPLE_TARGET = 50

/**
 * The one way to analyse a repository (#112).
 *
 * First try splicing the commits made since the cached analysis; when that is
 * impossible for any reason — nothing cached, history rewritten, prevHead off
 * the first-parent chain — run the full replay. The caller neither knows nor
 * cares which happened: the old split answered null to mean "now call the
 * other one yourself", and the one caller that remembered to was the renderer,
 * which cannot see the main-process cache state the decision depends on.
 *
 * Both paths report the same progress contract, take the same sample target,
 * and the caller's repo lock (ipc.ts) covers whichever ran.
 */
export async function analyze(
  repoPath: string,
  onProgress: (p: ProgressInfo) => void
): Promise<RepoAnalysis> {
  const spliced = await spliceFromCache(repoPath, onProgress)
  if (spliced) return spliced
  return analyzeRepo(repoPath, DEFAULT_SAMPLE_TARGET, onProgress)
}

/**
 * The full replay: every commit's numstat streamed once, sampled to
 * `sampleTarget` stops. analyze() is what callers want; this stays the
 * well-tested primitive the splice falls back to and the tests pin.
 */
/**
 * The one reading-history progress contract, both paths: every 500th commit
 * plus a final 100%, counted from `base` — 0 for a full replay, the previous
 * commit count for a splice — against the same total.
 */
function historyProgress(
  onProgress: (p: ProgressInfo) => void,
  base: number,
  total: number
): (index: number) => void {
  return (i) => {
    if (i % 500 === 0) {
      onProgress({ phase: 'reading-history', done: base + i + 1, total })
    }
  }
}

export async function analyzeRepo(
  repoPath: string,
  sampleTarget: number,
  onProgress: (p: ProgressInfo) => void
): Promise<RepoAnalysis> {
  // "git isn't installed", "that folder is gone" and "you can't read it" are
  // FriendlyErrors from exec and must not be swallowed into "not a repository" —
  // they are the failures the user can actually act on.
  const probe = await runGitResult(repoPath, ['rev-parse', '--is-inside-work-tree'])
  if (probe.stdout.trim() !== 'true') {
    throw new FriendlyError(await explainNotAWorkTree(repoPath, probe.stderr))
  }

  onProgress({ phase: 'counting', done: 0, total: 1 })
  let commitCount = 0
  try {
    commitCount = parseInt(
      (await runGit(repoPath, ['rev-list', '--count', '--first-parent', 'HEAD'])).trim(),
      10
    )
  } catch {
    // unborn HEAD (fresh `git init`, no commits) — rev-list exits non-zero
    commitCount = 0
  }
  if (!Number.isFinite(commitCount)) commitCount = 0

  // A repo with no commits still opens: `branch` comes from the symbolic ref
  // (which resolves even on an unborn branch), and we return an empty analysis
  // so the user can stage files and make the first commit from inside the app.
  if (commitCount === 0) {
    const unborn = (
      await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => 'main')
    ).trim()
    const empty: RepoAnalysis = {
      info: { path: repoPath, name: basename(repoPath), branch: unborn || 'main', commitCount: 0 },
      paths: [],
      authors: [],
      snapshots: []
    }
    cacheAnalysis(repoPath, empty, sampleTarget)
    return empty
  }

  // detached HEAD reports the literal "HEAD"; label it so the UI can show it
  const branchRaw = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const branch =
    branchRaw === 'HEAD'
      ? `detached @ ${(await runGit(repoPath, ['rev-parse', '--short', 'HEAD'])).trim()}`
      : branchRaw
  const sampleIdx = pickSampleIndices(commitCount, sampleTarget)

  const state = new Map<string, FileState>()
  const interner = createInterner()
  const snapshots = await replayRange(
    repoPath,
    'HEAD',
    state,
    interner,
    0,
    (i) => sampleIdx.has(i),
    historyProgress(onProgress, 0, commitCount)
  )

  onProgress({ phase: 'reading-history', done: commitCount, total: commitCount })

  const analysis: RepoAnalysis = {
    info: { path: repoPath, name: basename(repoPath), branch, commitCount },
    paths: interner.paths,
    authors: interner.authors,
    snapshots
  }
  cacheAnalysis(repoPath, analysis, sampleTarget)
  return analysis
}

/**
 * Splice commits made since the cached analysis instead of re-reading the
 * whole history. Returns null when a fast path is impossible (no cache, or
 * history was rewritten — rebase/amend/reset) and analyze() falls back to a
 * full replay. Private: the old public null contract is exactly what #112
 * removed — no caller should ever have to ask "was it spliced?".
 */
async function spliceFromCache(
  repoPath: string,
  onProgress: (p: ProgressInfo) => void
): Promise<RepoAnalysis | null> {
  const cached = analysisCache.get(repoPath)
  if (!cached || cached.analysis.snapshots.length === 0) return null
  const { analysis: prev, sampleTarget } = cached
  const prevHead = prev.snapshots[prev.snapshots.length - 1].hash

  const head = (await runGit(repoPath, ['rev-parse', 'HEAD'])).trim()
  const branch = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (head === prevHead) {
    // HEAD unchanged (e.g. branch metadata only) — refresh the branch name
    const analysis = { ...prev, info: { ...prev.info, branch } }
    cacheAnalysis(repoPath, analysis, sampleTarget)
    return analysis
  }

  // history rewritten? (rebase, amend, reset) → full re-analysis
  const ancestor = await runGitResult(repoPath, ['merge-base', '--is-ancestor', prevHead, head])
  if (ancestor.code !== 0) return null

  const added = parseInt(
    (
      await runGit(repoPath, ['rev-list', '--count', '--first-parent', `${prevHead}..${head}`])
    ).trim(),
    10
  )
  if (!Number.isFinite(added) || added === 0) return null

  // Reachability is not enough. replayRange walks --first-parent and the
  // numstat deltas telescope only against the previous first-parent state, so
  // prevHead has to sit on head's *first-parent chain* — not merely somewhere
  // in its ancestry. It does not when prevHead came in as a second parent:
  // analyse main, then switch to a branch that has merged main, and the
  // merge's diff-against-first-parent lands on a base that already contains
  // it, double-counting every line main added (#70).
  //
  // `head~added` follows first parents only, so it is prevHead exactly when
  // the chain is the one replayRange is about to walk.
  const chainBase = await runGitResult(repoPath, ['rev-parse', '--verify', `${head}~${added}`])
  if (chainBase.code !== 0 || chainBase.stdout.trim() !== prevHead) return null

  // seed exact HEAD state from the last snapshot (it is a full-state capture)
  const state = new Map<string, FileState>(
    materializeSnapshot(prev, prev.snapshots.length - 1).files.map((f) => [f.path, f])
  )
  // resume the interning tables append-only, so the old snapshots' ids stay
  // valid and the new ones share them
  const interner = createInterner(prev.paths, prev.authors)
  const commitCount = prev.info.commitCount + added
  // Re-sample across the whole timeline, old region included: capture the new
  // commits the sampling asks for, and drop the old captures it no longer wants.
  const keep = resampleIndices(
    prev.snapshots.map((s) => s.index),
    prev.info.commitCount,
    commitCount,
    sampleTarget
  )
  const newSnaps = await replayRange(
    repoPath,
    `${prevHead}..${head}`,
    state,
    interner,
    prev.info.commitCount,
    (i) => keep.has(i),
    // the same progress contract as the full replay — the splice used to run
    // silent, so which path ran decided whether the user saw any progress
    historyProgress(onProgress, prev.info.commitCount, commitCount)
  )

  const analysis: RepoAnalysis = {
    info: {
      ...prev.info,
      branch,
      commitCount
    },
    paths: interner.paths,
    authors: interner.authors,
    snapshots: [...prev.snapshots.filter((s) => keep.has(s.index)), ...newSnaps]
  }
  cacheAnalysis(repoPath, analysis, sampleTarget)
  onProgress({ phase: 'reading-history', done: commitCount, total: commitCount })
  return analysis
}
