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
  phase: 'counting' | 'reading-history' | 'cloning'
  done: number
  total: number
}

/** API exposed to the renderer via the preload bridge. */
export interface GitCityApi {
  /** Returns the installed git version, or null if git is missing. */
  checkGit(): Promise<string | null>
  selectFolder(): Promise<string | null>
  analyzeRepo(repoPath: string, samples: number): Promise<RepoAnalysis>
  /** Clones a public repo URL, returns the local path. */
  cloneRepo(url: string): Promise<string>
  /** Subscribe to progress events; returns an unsubscribe function. */
  onProgress(cb: (p: ProgressInfo) => void): () => void
}
