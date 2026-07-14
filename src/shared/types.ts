/** A single file's accumulated metrics at one point in history. */
export interface FileState {
  path: string
  loc: number
  commits: number
  /** unix ms of the last commit touching this file */
  lastTouched: number
  lastAuthor: string
  binary: boolean
}

/** The full repo state at one sampled commit. */
export interface Snapshot {
  hash: string
  /** unix ms */
  date: number
  author: string
  message: string
  /** 0-based index of this commit along first-parent history */
  index: number
  files: FileState[]
}

export interface RepoInfo {
  path: string
  name: string
  branch: string
  /** first-parent commit count */
  commitCount: number
}

export interface RepoAnalysis {
  info: RepoInfo
  /** ordered oldest → newest; the last snapshot is HEAD */
  snapshots: Snapshot[]
}

export interface ProgressInfo {
  phase: 'counting' | 'reading-history' | 'cloning' | 'fetching' | 'pulling' | 'pushing'
  done: number
  total: number
}

/** One side of a porcelain v2 XY status pair, normalized. */
export type StatusCode =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export interface FileStatus {
  path: string
  /** rename source, when git detected a rename */
  origPath?: string
  /** staged side */
  index: StatusCode
  /** unstaged side */
  worktree: StatusCode
  conflicted: boolean
}

/** A multi-step git operation the repo is currently in the middle of. */
export type RepoOpState = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface RemoteInfo {
  name: string
  url: string
}

export interface WorkingStatus {
  /** null when HEAD is detached */
  branch: string | null
  /** short hash when detached, else null */
  detachedAt: string | null
  upstream: string | null
  ahead: number
  /** -1 when the upstream ref is gone */
  behind: number
  files: FileStatus[]
  opState: RepoOpState
  /** current step / total steps while a rebase is underway */
  rebaseProgress?: { done: number; total: number }
  stashCount: number
  remotes: RemoteInfo[]
  /** full HEAD hash; empty string before the first commit */
  headHash: string
}

export interface BranchInfo {
  /** short name: local 'feature/sync', or remote-tracking 'origin/feature/sync' */
  name: string
  current: boolean
  /** true for a refs/remotes/* branch not yet checked out locally */
  isRemote: boolean
  upstream: string | null
  ahead: number
  behind: number
  lastCommitHash: string
  /** unix ms */
  lastCommitDate: number
  lastCommitSubject: string
}

export interface StashEntry {
  index: number
  message: string
  /** unix ms */
  date: number
}

/**
 * Uniform result of every mutating git operation. Expected git failures
 * (conflicts, auth, rejections) come back here — never as thrown errors,
 * which Electron IPC mangles.
 */
export interface OpResult {
  ok: boolean
  code?:
    | 'conflict'
    | 'auth'
    | 'no-upstream'
    | 'rejected'
    | 'dirty'
    | 'not-merged'
    | 'nothing-to-do'
    | 'unknown'
  /** friendly one-liner for the UI */
  message?: string
  /** raw git output for the expandable details section */
  gitOutput?: string
  /** conflicted paths when code === 'conflict' */
  conflicts?: string[]
}

export interface ConflictFile {
  path: string
  /** binary files have no hunks; only whole-file ours/theirs applies */
  binary: boolean
  segments: ConflictSegment[]
}

export type ConflictSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'conflict'
      id: number
      ours: string
      theirs: string
      /** present when merge.conflictStyle=diff3 */
      base?: string
      oursLabel: string
      theirsLabel: string
    }

export type RepoChangeReason = 'worktree' | 'index' | 'head' | 'refs'

/** API exposed to the renderer via the preload bridge. */
export interface GitCityApi {
  /** Returns the installed git version, or null if git is missing. */
  checkGit(): Promise<string | null>
  selectFolder(): Promise<string | null>
  analyzeRepo(repoPath: string, samples: number): Promise<RepoAnalysis>
  /** Incremental history update after our own HEAD move; null → caller should run a full analyze. */
  analyzeIncremental(repoPath: string): Promise<RepoAnalysis | null>
  /** Clones a public repo URL, returns the local path. */
  cloneRepo(url: string): Promise<string>
  /** Subscribe to progress events; returns an unsubscribe function. */
  onProgress(cb: (p: ProgressInfo) => void): () => void

  // --- live repo state ---
  status(repoPath: string): Promise<WorkingStatus>
  watchStart(repoPath: string): Promise<void>
  watchStop(): Promise<void>
  onRepoChanged(cb: (reasons: RepoChangeReason[]) => void): () => void

  // --- stage / commit ---
  stage(repoPath: string, paths: string[]): Promise<OpResult>
  unstage(repoPath: string, paths: string[]): Promise<OpResult>
  discard(repoPath: string, paths: string[]): Promise<OpResult>
  commit(repoPath: string, message: string, amend: boolean): Promise<OpResult>
  lastCommitMessage(repoPath: string): Promise<string>

  // --- sync ---
  fetch(repoPath: string): Promise<OpResult>
  pull(repoPath: string): Promise<OpResult>
  push(repoPath: string, setUpstream?: boolean): Promise<OpResult>
  cancelOp(): Promise<void>

  // --- branches ---
  branches(repoPath: string): Promise<BranchInfo[]>
  switchBranch(repoPath: string, name: string): Promise<OpResult>
  createBranch(repoPath: string, name: string, andSwitch: boolean): Promise<OpResult>
  deleteBranch(repoPath: string, name: string, force: boolean): Promise<OpResult>

  // --- merge + conflicts ---
  merge(repoPath: string, branch: string): Promise<OpResult>
  mergeAbort(repoPath: string): Promise<OpResult>
  mergeContinue(repoPath: string): Promise<OpResult>
  conflictRead(repoPath: string, path: string): Promise<ConflictFile>
  conflictResolve(repoPath: string, path: string, text: string): Promise<OpResult>
  conflictResolveWhole(repoPath: string, path: string, side: 'ours' | 'theirs'): Promise<OpResult>
  openInEditor(repoPath: string, path: string): Promise<void>

  // --- stash ---
  stashList(repoPath: string): Promise<StashEntry[]>
  stashPush(repoPath: string, message: string, includeUntracked: boolean): Promise<OpResult>
  stashPop(repoPath: string, index: number): Promise<OpResult>
  stashApply(repoPath: string, index: number): Promise<OpResult>
  stashDrop(repoPath: string, index: number): Promise<OpResult>

  // --- advanced ---
  cherryPick(repoPath: string, hash: string): Promise<OpResult>
  cherryPickContinue(repoPath: string): Promise<OpResult>
  cherryPickAbort(repoPath: string): Promise<OpResult>
  rebase(repoPath: string, onto: string): Promise<OpResult>
  rebaseContinue(repoPath: string): Promise<OpResult>
  rebaseAbort(repoPath: string): Promise<OpResult>
}
