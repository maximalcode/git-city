import { basename } from 'path'
import type { FileState, ProgressInfo, RepoAnalysis, RepoSize, Snapshot } from '../../shared/types'
import { runGit, runGitLines, runGitResult } from './exec'
import { FriendlyError } from './result'

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

export async function checkGitInstalled(): Promise<string | null> {
  try {
    const v = await runGit(process.cwd(), ['--version'])
    return v.trim()
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
  startIndex: number,
  shouldSnapshot: (index: number) => boolean,
  onCommitDone?: (index: number) => void
): Promise<Snapshot[]> {
  const snapshots: Snapshot[] = []
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
      snapshots.push({
        hash: current.hash,
        date: current.date,
        author: current.author,
        message: current.message,
        index: commitIndex,
        files: Array.from(state.values(), (f) => ({ ...f }))
      })
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
 * Last full analysis per repo, kept so analyzeIncremental can splice new
 * commits without re-reading the whole history. Analyses are too big to
 * round-trip over IPC, so the renderer only ever asks by repoPath.
 */
const analysisCache = new Map<string, RepoAnalysis>()

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

export async function analyzeRepo(
  repoPath: string,
  sampleTarget: number,
  onProgress: (p: ProgressInfo) => void
): Promise<RepoAnalysis> {
  const inside = (
    await runGit(repoPath, ['rev-parse', '--is-inside-work-tree']).catch((err) => {
      // "git isn't installed" must not be swallowed into "not a repository" —
      // it is the one failure here the user can actually do something about
      if (err instanceof FriendlyError) throw err
      return 'false'
    })
  ).trim()
  if (inside !== 'true') {
    throw new Error('The selected folder is not a git repository.')
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
      snapshots: []
    }
    analysisCache.set(repoPath, empty)
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
  const snapshots = await replayRange(
    repoPath,
    'HEAD',
    state,
    0,
    (i) => sampleIdx.has(i),
    (i) => {
      if (i % 500 === 0) {
        onProgress({ phase: 'reading-history', done: i + 1, total: commitCount })
      }
    }
  )

  onProgress({ phase: 'reading-history', done: commitCount, total: commitCount })

  const analysis: RepoAnalysis = {
    info: { path: repoPath, name: basename(repoPath), branch, commitCount },
    snapshots
  }
  analysisCache.set(repoPath, analysis)
  return analysis
}

/**
 * Splice commits made since the cached analysis instead of re-reading the
 * whole history. Returns null when a fast path is impossible (no cache, or
 * history was rewritten — rebase/amend/reset) so the caller falls back to a
 * full analyzeRepo.
 */
export async function analyzeIncremental(repoPath: string): Promise<RepoAnalysis | null> {
  const prev = analysisCache.get(repoPath)
  if (!prev || prev.snapshots.length === 0) return null
  const prevHead = prev.snapshots[prev.snapshots.length - 1].hash

  const head = (await runGit(repoPath, ['rev-parse', 'HEAD'])).trim()
  const branch = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (head === prevHead) {
    // HEAD unchanged (e.g. branch metadata only) — refresh the branch name
    const analysis = { ...prev, info: { ...prev.info, branch } }
    analysisCache.set(repoPath, analysis)
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

  // seed exact HEAD state from the last snapshot (it is a full-state capture)
  const state = new Map<string, FileState>(
    prev.snapshots[prev.snapshots.length - 1].files.map((f) => [f.path, { ...f }])
  )
  const newSnaps = await replayRange(
    repoPath,
    `${prevHead}..${head}`,
    state,
    prev.info.commitCount,
    () => true // snapshot every new commit — there are few
  )

  const analysis: RepoAnalysis = {
    info: {
      ...prev.info,
      branch,
      commitCount: prev.info.commitCount + added
    },
    snapshots: [...prev.snapshots, ...newSnaps]
  }
  analysisCache.set(repoPath, analysis)
  return analysis
}
