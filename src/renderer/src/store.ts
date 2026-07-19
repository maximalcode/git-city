import { create } from 'zustand'
import type {
  BranchInfo,
  GitHubAuth,
  OpResult,
  ProgressInfo,
  HunkMode,
  PullRequestInfo,
  RebaseEntry,
  RepoAnalysis,
  RepoOpState,
  ResetMode,
  StashEntry,
  SubmoduleInfo,
  TagInfo,
  WorkingStatus,
  WorktreeInfo
} from '../../shared/types'
import { DEFAULT_THEME_ID } from './city/themes'
import type { ColorMode } from './city/colorModes'

export type { ColorMode }

const THEME_KEY = 'gitcity.theme'
function loadTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}
function saveTheme(id: string): void {
  try {
    localStorage.setItem(THEME_KEY, id)
  } catch {
    /* private mode / no storage — theme just won't persist */
  }
}

export type ViewMode = 'city' | 'forest'
const VIEW_KEY = 'gitcity.view'
function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'forest' ? 'forest' : 'city'
  } catch {
    return 'city'
  }
}
function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, mode)
  } catch {
    /* private mode / no storage — view just won't persist */
  }
}

const TOD_KEY = 'gitcity.tod'
function loadTimeOfDay(): number {
  try {
    const raw = localStorage.getItem(TOD_KEY)
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5
  } catch {
    return 0.5
  }
}
function saveTimeOfDay(t: number): void {
  try {
    localStorage.setItem(TOD_KEY, String(t))
  } catch {
    /* ignore */
  }
}

const HOTSPOTS_KEY = 'gitcity.hotspots'
function loadShowHotspots(): boolean {
  try {
    return localStorage.getItem(HOTSPOTS_KEY) !== 'off'
  } catch {
    return true
  }
}
function saveShowHotspots(on: boolean): void {
  try {
    localStorage.setItem(HOTSPOTS_KEY, on ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

const DIFFSPLIT_KEY = 'gitcity.diffsplit'
function loadDiffSplit(): boolean {
  try {
    return localStorage.getItem(DIFFSPLIT_KEY) === 'on'
  } catch {
    return false
  }
}
function saveDiffSplit(on: boolean): void {
  try {
    localStorage.setItem(DIFFSPLIT_KEY, on ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

const REDUCEMOTION_KEY = 'gitcity.reducemotion'
function loadReduceMotion(): boolean {
  try {
    return localStorage.getItem(REDUCEMOTION_KEY) === 'on'
  } catch {
    return false
  }
}
function saveReduceMotion(on: boolean): void {
  try {
    localStorage.setItem(REDUCEMOTION_KEY, on ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

const ONBOARD_KEY = 'gitcity.onboarded'
function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARD_KEY) === '1'
  } catch {
    return false
  }
}
function saveOnboarded(): void {
  try {
    localStorage.setItem(ONBOARD_KEY, '1')
  } catch {
    /* ignore */
  }
}

const RECENT_KEY = 'gitcity.recent'
const RECENT_MAX = 8
function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}
function saveRecent(paths: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(paths.slice(0, RECENT_MAX)))
  } catch {
    /* ignore */
  }
}
export type Panel = 'none' | 'changes' | 'branches' | 'stashes'

export interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  danger: boolean
  onConfirm: () => void
}

export interface MergeViewState {
  active: string | null
  source: RepoOpState
}

export type EffectKind = 'commit-settle' | 'push' | 'pull' | 'rewind'

export function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Electron prefixes IPC errors with "Error invoking remote method '...': Error:"
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/** Whether the preload API exists (absent when the renderer runs in a plain browser). */
export const hasApi = (): boolean => 'gitCity' in window

/**
 * Everything scoped to one open repo. Applied on BOTH leaving the city and
 * loading a repo, so stale panels/dialogs/effects can never leak between repos
 * no matter which path a future feature takes.
 */
const REPO_STATE_RESET: Partial<GitCityState> = {
  selected: null,
  hovered: null,
  playing: false,
  searchOpen: false,
  workingStatus: null,
  branches: [],
  stashes: [],
  tags: [],
  submodules: [],
  worktrees: [],
  githubAuth: null,
  pullRequests: [],
  currentPr: null,
  prPanelOpen: false,
  prLoading: false,
  rebaseOpen: false,
  reflogOpen: false,
  panel: 'none',
  opError: null,
  confirm: null,
  mergeView: null,
  historyStale: false,
  effect: null,
  diffOpen: false,
  diffRev: null,
  fileView: 'none',
  graphOpen: false,
  paletteOpen: false,
  helpOpen: false,
  commitDetailHash: null
}

/** Cheap fingerprint so identical statuses (editor atomic-save churn) don't re-render.
 *  Must cover every field the HUD renders: omitting one (e.g. upstream) makes ops whose
 *  only effect is that field (publish) invisible to refreshStatus. Exported for tests. */
export function statusFingerprint(s: WorkingStatus | null): string {
  if (!s) return ''
  return `${s.headHash}|${s.opState}|${s.ahead},${s.behind}|${s.branch}|${s.upstream ?? ''}|${
    s.stashCount
  }|${s.files.map((f) => `${f.path}:${f.index}${f.worktree}${f.conflicted ? 'C' : ''}`).join(',')}`
}

interface GitCityState {
  screen: 'welcome' | 'loading' | 'city'
  analysis: RepoAnalysis | null
  snapshotIndex: number
  playing: boolean
  hovered: string | null
  selected: string | null
  colorMode: ColorMode
  themeId: string
  viewMode: ViewMode
  progress: ProgressInfo | null
  error: string | null
  gitVersion: string | null | 'unknown'
  recentRepos: string[]
  searchOpen: boolean

  // --- live repo state ---
  repoPath: string | null
  workingStatus: WorkingStatus | null
  branches: BranchInfo[]
  stashes: StashEntry[]
  tags: TagInfo[]
  submodules: SubmoduleInfo[]
  worktrees: WorktreeInfo[]
  githubAuth: GitHubAuth | null
  pullRequests: PullRequestInfo[]
  currentPr: PullRequestInfo | null
  prPanelOpen: boolean
  prLoading: boolean
  rebaseOpen: boolean
  reflogOpen: boolean
  panel: Panel
  opInProgress: { label: string } | null
  opError: { message: string; gitOutput?: string } | null
  confirm: ConfirmRequest | null
  mergeView: MergeViewState | null
  historyStale: boolean
  effect: { kind: EffectKind; nonce: number } | null
  reanalyzing: boolean
  diffOpen: boolean
  /** Explicit revision to diff (set when opened from a history commit); null = context-derived. */
  diffRev: string | null
  fileView: 'none' | 'history' | 'blame'
  graphOpen: boolean
  /** command palette (Ctrl/Cmd-K) overlay */
  paletteOpen: boolean
  /** time-of-day for the sun, 0..1 (0/1 = midnight, 0.5 = noon); global pref */
  timeOfDay: number
  /** pulse the repo's current hotspots (most-churned recent files); global pref */
  showHotspots: boolean
  /** diff viewer layout: split (side-by-side) vs unified; global pref */
  diffSplit: boolean
  /** damp the cinematic intro orbit (and other flourishes); global pref */
  reduceMotion: boolean
  /** settings panel open */
  settingsOpen: boolean
  /** whether the first-run "what am I seeing?" overlay has been dismissed */
  onboarded: boolean
  /** transient: the encoding guide re-opened from the "?" button */
  helpOpen: boolean
  /** commit whose detail panel is open (from a search hit), or null */
  commitDetailHash: string | null

  init(): void
  openLocal(): Promise<void>
  openPath(path: string): Promise<void>
  openUrl(url: string): Promise<void>
  setSearchOpen(open: boolean): void
  clearRecent(): void
  setSnapshotIndex(i: number): void
  setPlaying(playing: boolean): void
  setHovered(path: string | null): void
  setSelected(path: string | null): void
  setColorMode(mode: ColorMode): void
  setTheme(id: string): void
  setViewMode(mode: ViewMode): void
  setDiffOpen(open: boolean, rev?: string): void
  setFileView(view: 'none' | 'history' | 'blame'): void
  setGraphOpen(open: boolean): void
  setPaletteOpen(open: boolean): void
  setTimeOfDay(t: number): void
  toggleHotspots(): void
  toggleDiffSplit(): void
  toggleReduceMotion(): void
  setSettingsOpen(open: boolean): void
  resetPreferences(): void
  dismissOnboarding(): void
  setHelpOpen(open: boolean): void
  openCommit(hash: string): void
  closeCommit(): void
  backToWelcome(): void

  // live actions
  setPanel(panel: Panel): void
  refreshStatus(): Promise<void>
  refreshBranches(): Promise<void>
  refreshStashes(): Promise<void>
  refreshTags(): Promise<void>
  refreshSubmodules(): Promise<void>
  refreshWorktrees(): Promise<void>
  updateSubmodules(path?: string): Promise<void>
  addWorktree(path: string, ref: string): Promise<void>
  removeWorktree(path: string, force: boolean): Promise<void>
  setPrPanelOpen(open: boolean): void
  refreshGitHub(): Promise<void>
  checkoutPr(number: number): Promise<void>
  createPr(base: string, title: string, body: string): Promise<void>
  openExternal(url: string): void
  setRebaseOpen(open: boolean): void
  setReflogOpen(open: boolean): void
  createTag(name: string, ref?: string): Promise<void>
  deleteTag(name: string): Promise<void>
  /** Undo the last thing that moved HEAD (reset --keep HEAD@{1}) — never loses uncommitted work. */
  undoLast(): Promise<void>
  resetToReflog(ref: string, mode: ResetMode): Promise<void>
  recoverBranch(name: string, ref: string): Promise<void>
  runInteractiveRebase(base: string | null, entries: RebaseEntry[]): Promise<boolean>
  refreshAnalysis(): Promise<void>
  jumpToNow(): void
  dismissError(): void
  askConfirm(req: ConfirmRequest): void
  resolveConfirm(go: boolean): void

  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  discard(paths: string[]): Promise<void>
  applyHunk(path: string, header: string, mode: HunkMode): Promise<void>
  commit(message: string, amend: boolean, sign?: boolean): Promise<void>
  fetch(): Promise<void>
  pull(): Promise<void>
  push(setUpstream: boolean): Promise<void>
  cancelOp(): Promise<void>
  switchBranch(name: string): Promise<void>
  createBranch(name: string, andSwitch: boolean): Promise<void>
  deleteBranch(name: string, force: boolean): Promise<void>
  merge(name: string): Promise<void>
  rebaseOnto(name: string): Promise<void>
  cherryPick(hash: string): Promise<void>
  stashPush(message: string, includeUntracked: boolean): Promise<void>
  stashPop(index: number): Promise<void>
  stashApply(index: number): Promise<void>
  stashDrop(index: number): Promise<void>
  openMergeView(): void
  closeMergeView(): void
  setMergeActive(path: string | null): void
  resolveConflict(path: string, text: string): Promise<void>
  resolveWhole(path: string, side: 'ours' | 'theirs'): Promise<void>
  abortOp(): Promise<void>
  continueOp(): Promise<void>
}

let lastFingerprint = ''

export const useStore = create<GitCityState>((set, get) => ({
  screen: 'welcome',
  analysis: null,
  snapshotIndex: 0,
  playing: false,
  hovered: null,
  selected: null,
  colorMode: 'language',
  themeId: loadTheme(),
  viewMode: loadViewMode(),
  progress: null,
  error: null,
  gitVersion: 'unknown',
  recentRepos: loadRecent(),
  searchOpen: false,

  repoPath: null,
  workingStatus: null,
  branches: [],
  stashes: [],
  tags: [],
  submodules: [],
  worktrees: [],
  githubAuth: null,
  pullRequests: [],
  currentPr: null,
  prPanelOpen: false,
  prLoading: false,
  rebaseOpen: false,
  reflogOpen: false,
  panel: 'none',
  opInProgress: null,
  opError: null,
  confirm: null,
  mergeView: null,
  historyStale: false,
  effect: null,
  reanalyzing: false,
  diffOpen: false,
  diffRev: null,
  fileView: 'none',
  graphOpen: false,
  paletteOpen: false,
  timeOfDay: loadTimeOfDay(),
  showHotspots: loadShowHotspots(),
  diffSplit: loadDiffSplit(),
  reduceMotion: loadReduceMotion(),
  settingsOpen: false,
  onboarded: loadOnboarded(),
  helpOpen: false,
  commitDetailHash: null,

  init: () => {
    // absent when the renderer runs in a plain browser (vite preview) instead of Electron
    if (!hasApi()) return
    window.gitCity.onProgress((p) => set({ progress: p }))
    window.gitCity.onRepoChanged((reasons) => {
      void get().refreshStatus()
      if (reasons.includes('head') || reasons.includes('refs')) {
        void get().refreshBranches()
        void get().refreshStashes()
        void get().refreshTags()
        // external HEAD move: don't surprise-reanalyze; offer a reload pill
        const s = get()
        if (s.opInProgress === null && s.reanalyzing === false) set({ historyStale: true })
      }
    })
    window.gitCity
      .checkGit()
      .then((v) => set({ gitVersion: v }))
      .catch(() => set({ gitVersion: null }))
  },

  openLocal: async () => {
    if (!hasApi()) return
    const path = await window.gitCity.selectFolder()
    if (!path) return
    await get().openPath(path)
  },

  openPath: async (path: string) => {
    if (!hasApi()) return
    await loadRepo(set, get, () => window.gitCity.analyzeRepo(path, 50), path)
  },

  setSearchOpen: (searchOpen) => set({ searchOpen }),

  clearRecent: () => {
    saveRecent([])
    set({ recentRepos: [] })
  },

  openUrl: async (url: string) => {
    if (!hasApi()) return
    set({ screen: 'loading', error: null, progress: null })
    try {
      const path = await window.gitCity.cloneRepo(url)
      await loadRepo(set, get, () => window.gitCity.analyzeRepo(path, 50), path)
    } catch (err) {
      set({ screen: 'welcome', error: cleanError(err) })
    }
  },

  setSnapshotIndex: (i) => set({ snapshotIndex: i, playing: false }),
  setPlaying: (playing) => {
    const { analysis, snapshotIndex } = get()
    if (playing && analysis && snapshotIndex >= analysis.snapshots.length - 1) {
      set({ playing, snapshotIndex: 0 })
    } else {
      set({ playing })
    }
  },
  setHovered: (hovered) => set({ hovered }),
  setSelected: (selected) => set({ selected }),
  setColorMode: (colorMode) => set({ colorMode }),
  setTheme: (themeId) => {
    saveTheme(themeId)
    set({ themeId })
  },
  // user preference like the theme: persisted, survives repo switches
  setViewMode: (viewMode) => {
    saveViewMode(viewMode)
    set({ viewMode })
  },
  // Opening without an explicit rev replaces the history/blame panel (they share
  // the same spot); opening WITH a rev (from a history commit) keeps history
  // underneath so closing the diff returns to it.
  setDiffOpen: (diffOpen, rev) =>
    set((s) => ({
      diffOpen,
      diffRev: diffOpen ? (rev ?? null) : null,
      fileView: diffOpen && rev === undefined ? 'none' : s.fileView
    })),
  setFileView: (fileView) =>
    set({ fileView, diffOpen: fileView !== 'none' ? false : get().diffOpen }),
  setGraphOpen: (graphOpen) => set({ graphOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setTimeOfDay: (t) => {
    const timeOfDay = Math.min(1, Math.max(0, t))
    saveTimeOfDay(timeOfDay)
    set({ timeOfDay })
  },
  toggleHotspots: () => {
    const showHotspots = !get().showHotspots
    saveShowHotspots(showHotspots)
    set({ showHotspots })
  },
  toggleDiffSplit: () => {
    const diffSplit = !get().diffSplit
    saveDiffSplit(diffSplit)
    set({ diffSplit })
  },
  toggleReduceMotion: () => {
    const reduceMotion = !get().reduceMotion
    saveReduceMotion(reduceMotion)
    set({ reduceMotion })
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  resetPreferences: () => {
    // wipe every persisted appearance/behaviour pref and return to defaults.
    // Recent repos are deliberately kept — they're data, not a preference,
    // and have their own "Clear" action.
    for (const key of [
      THEME_KEY,
      VIEW_KEY,
      TOD_KEY,
      HOTSPOTS_KEY,
      DIFFSPLIT_KEY,
      REDUCEMOTION_KEY,
      ONBOARD_KEY
    ]) {
      try {
        localStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    }
    set({
      themeId: DEFAULT_THEME_ID,
      viewMode: 'city',
      timeOfDay: 0.5,
      showHotspots: true,
      diffSplit: false,
      reduceMotion: false,
      onboarded: false
    })
  },
  dismissOnboarding: () => {
    saveOnboarded()
    set({ onboarded: true, helpOpen: false })
  },
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  openCommit: (hash) => set({ commitDetailHash: hash, paletteOpen: false }),
  closeCommit: () => set({ commitDetailHash: null }),
  backToWelcome: () => {
    if (hasApi()) void window.gitCity.watchStop()
    lastFingerprint = ''
    set({
      ...REPO_STATE_RESET,
      screen: 'welcome',
      analysis: null,
      repoPath: null
    })
  },

  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? 'none' : panel })),

  refreshStatus: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    try {
      const status = await window.gitCity.status(repoPath)
      const fp = statusFingerprint(status)
      if (fp === lastFingerprint) return
      lastFingerprint = fp
      set({ workingStatus: status })
      // conflicts appeared while a merge view is open → nothing to do; gone → maybe close
    } catch {
      // status can briefly fail during an index.lock window; the next event retries
    }
  },

  refreshBranches: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    try {
      set({ branches: await window.gitCity.branches(repoPath) })
    } catch {
      /* ignore */
    }
  },

  refreshStashes: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    try {
      set({ stashes: await window.gitCity.stashList(repoPath) })
    } catch {
      /* ignore */
    }
  },

  refreshTags: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    try {
      set({ tags: await window.gitCity.tags(repoPath) })
    } catch {
      /* ignore */
    }
  },

  refreshSubmodules: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    try {
      set({ submodules: await window.gitCity.submodules(repoPath) })
    } catch {
      /* ignore */
    }
  },

  refreshWorktrees: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    try {
      set({ worktrees: await window.gitCity.worktrees(repoPath) })
    } catch {
      /* ignore */
    }
  },

  updateSubmodules: (path) =>
    runOp(set, get, 'Updating submodules…', (repo) => window.gitCity.updateSubmodules(repo, path)),
  addWorktree: (path, ref) =>
    runOp(set, get, 'Adding worktree…', (repo) => window.gitCity.addWorktree(repo, path, ref)),
  removeWorktree: (path, force) =>
    runOp(set, get, 'Removing worktree…', (repo) =>
      window.gitCity.removeWorktree(repo, path, force)
    ),

  setPrPanelOpen: (prPanelOpen) => {
    set({ prPanelOpen })
    if (prPanelOpen) void get().refreshGitHub()
  },
  refreshGitHub: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    set({ prLoading: true })
    try {
      const auth = await window.gitCity.ghStatus(repoPath)
      if (!auth.authed || !auth.isGitHub) {
        set({ githubAuth: auth, pullRequests: [], currentPr: null })
        return
      }
      const [pullRequests, currentPr] = await Promise.all([
        window.gitCity.listPullRequests(repoPath),
        window.gitCity.currentBranchPr(repoPath)
      ])
      set({ githubAuth: auth, pullRequests, currentPr })
    } catch {
      /* leave prior state; gh hiccup */
    } finally {
      set({ prLoading: false })
    }
  },
  checkoutPr: (number) =>
    runOp(
      set,
      get,
      `Checking out PR #${number}…`,
      (repo) => window.gitCity.checkoutPr(repo, number),
      {
        reanalyze: true
      }
    ),
  createPr: async (base, title, body) => {
    await runOp(set, get, 'Creating pull request…', (repo) =>
      window.gitCity.createPr(repo, base, title, body)
    )
    if (!get().opError) await get().refreshGitHub()
  },
  openExternal: (url) => {
    if (hasApi()) void window.gitCity.openExternal(url)
  },

  setRebaseOpen: (rebaseOpen) => set({ rebaseOpen }),
  setReflogOpen: (reflogOpen) => set({ reflogOpen }),

  createTag: (name, ref) =>
    runOp(set, get, 'Creating tag…', (repo) => window.gitCity.createTag(repo, name, ref)),
  deleteTag: (name) =>
    runOp(set, get, 'Deleting tag…', (repo) => window.gitCity.deleteTag(repo, name)),

  // HEAD@{1} is the position before the last HEAD move; --keep refuses rather
  // than clobber uncommitted work, so one-click undo is always safe.
  undoLast: () =>
    runOp(set, get, 'Undoing…', (repo) => window.gitCity.resetTo(repo, 'HEAD@{1}', 'keep'), {
      reanalyze: true,
      effect: 'rewind'
    }),
  resetToReflog: (ref, mode) =>
    runOp(set, get, 'Restoring…', (repo) => window.gitCity.resetTo(repo, ref, mode), {
      reanalyze: true,
      effect: 'rewind'
    }),
  recoverBranch: (name, ref) =>
    runOp(set, get, 'Recovering…', (repo) => window.gitCity.recoverToBranch(repo, name, ref), {
      reanalyze: true
    }),

  runInteractiveRebase: async (base, entries) => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return false
    set({ opInProgress: { label: 'Rebasing…' }, opError: null })
    let result: OpResult
    try {
      result = await window.gitCity.rebaseInteractive(repoPath, base, entries)
    } catch (err) {
      set({ opInProgress: null, opError: { message: cleanError(err) } })
      return false
    }
    set({ opInProgress: null })
    await get().refreshStatus()
    await get().refreshBranches()
    if (!result.ok) {
      if (result.code === 'conflict') {
        set({
          rebaseOpen: false,
          mergeView: { active: result.conflicts?.[0] ?? null, source: 'rebase' }
        })
      } else {
        set({
          opError: { message: result.message ?? 'Rebase failed.', gitOutput: result.gitOutput }
        })
      }
      return false
    }
    set({ rebaseOpen: false })
    triggerEffect(set, get, 'commit-settle')
    await get().refreshAnalysis()
    return true
  },

  refreshAnalysis: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    set({ reanalyzing: true, historyStale: false })
    try {
      let analysis = await window.gitCity.analyzeIncremental(repoPath)
      if (!analysis) analysis = await window.gitCity.analyzeRepo(repoPath, 50)
      const wasLive = isLiveState(get())
      set((s) => ({
        analysis,
        // if the user was watching the latest state, keep them there
        snapshotIndex: wasLive ? analysis!.snapshots.length - 1 : s.snapshotIndex
      }))
    } catch (err) {
      set({ opError: { message: cleanError(err) } })
    } finally {
      set({ reanalyzing: false })
    }
  },

  jumpToNow: () => {
    const { analysis } = get()
    if (analysis) set({ snapshotIndex: analysis.snapshots.length - 1, playing: false })
  },

  dismissError: () => set({ opError: null }),
  askConfirm: (req) => set({ confirm: req }),
  resolveConfirm: (go) => {
    const req = get().confirm
    set({ confirm: null })
    if (go && req) req.onConfirm()
  },

  // --- mutating actions (all funnel through runOp) ---
  stage: (paths) => runOp(set, get, 'Staging…', (repo) => window.gitCity.stage(repo, paths)),
  unstage: (paths) => runOp(set, get, 'Unstaging…', (repo) => window.gitCity.unstage(repo, paths)),
  discard: (paths) => runOp(set, get, 'Discarding…', (repo) => window.gitCity.discard(repo, paths)),
  applyHunk: (path, header, mode) => {
    const label =
      mode === 'stage'
        ? 'Staging hunk…'
        : mode === 'unstage'
          ? 'Unstaging hunk…'
          : 'Discarding hunk…'
    return runOp(set, get, label, (repo) => window.gitCity.applyHunk(repo, path, header, mode))
  },
  commit: (message, amend, sign) =>
    runOp(
      set,
      get,
      amend ? 'Amending…' : 'Committing…',
      (repo) => window.gitCity.commit(repo, message, amend, sign),
      { reanalyze: true, effect: 'commit-settle' }
    ),
  // fetch never moves HEAD — it only updates remote refs, so no re-analysis;
  // the payoff is refreshBranches() (runs after every op) surfacing updated remotes
  fetch: () => runOp(set, get, 'Fetching…', (repo) => window.gitCity.fetch(repo)),
  pull: () =>
    runOp(set, get, 'Pulling…', (repo) => window.gitCity.pull(repo), {
      reanalyze: true,
      effect: 'pull',
      conflictsOpenMerge: true
    }),
  push: (setUpstream) =>
    runOp(set, get, 'Pushing…', (repo) => window.gitCity.push(repo, setUpstream), {
      effect: 'push'
    }),
  cancelOp: async () => {
    if (hasApi()) await window.gitCity.cancelOp()
  },
  switchBranch: (name) =>
    runOp(set, get, `Switching to ${name}…`, (repo) => window.gitCity.switchBranch(repo, name), {
      reanalyze: true
    }),
  createBranch: (name, andSwitch) =>
    runOp(
      set,
      get,
      'Creating branch…',
      (repo) => window.gitCity.createBranch(repo, name, andSwitch),
      { reanalyze: andSwitch }
    ),
  deleteBranch: (name, force) =>
    runOp(set, get, 'Deleting branch…', (repo) => window.gitCity.deleteBranch(repo, name, force)),
  merge: (name) =>
    runOp(set, get, `Merging ${name}…`, (repo) => window.gitCity.merge(repo, name), {
      reanalyze: true,
      conflictsOpenMerge: true
    }),
  rebaseOnto: (name) =>
    runOp(set, get, `Rebasing onto ${name}…`, (repo) => window.gitCity.rebase(repo, name), {
      reanalyze: true,
      conflictsOpenMerge: true
    }),
  cherryPick: (hash) =>
    runOp(set, get, 'Cherry-picking…', (repo) => window.gitCity.cherryPick(repo, hash), {
      reanalyze: true,
      conflictsOpenMerge: true
    }),
  stashPush: (message, includeUntracked) =>
    runOp(set, get, 'Stashing…', (repo) =>
      window.gitCity.stashPush(repo, message, includeUntracked)
    ),
  stashPop: (index) =>
    runOp(set, get, 'Applying stash…', (repo) => window.gitCity.stashPop(repo, index), {
      conflictsOpenMerge: true
    }),
  stashApply: (index) =>
    runOp(set, get, 'Applying stash…', (repo) => window.gitCity.stashApply(repo, index), {
      conflictsOpenMerge: true
    }),
  stashDrop: (index) =>
    runOp(set, get, 'Dropping stash…', (repo) => window.gitCity.stashDrop(repo, index)),

  openMergeView: () => {
    const st = get().workingStatus
    set({ mergeView: { active: null, source: st?.opState ?? 'merge' } })
  },
  closeMergeView: () => set({ mergeView: null }),
  setMergeActive: (path) =>
    set((s) => (s.mergeView ? { mergeView: { ...s.mergeView, active: path } } : {})),
  resolveConflict: (path, text) =>
    runOp(set, get, 'Marking resolved…', (repo) =>
      window.gitCity.conflictResolve(repo, path, text)
    ),
  resolveWhole: (path, side) =>
    runOp(set, get, 'Marking resolved…', (repo) =>
      window.gitCity.conflictResolveWhole(repo, path, side)
    ),
  abortOp: () => {
    const source = get().workingStatus?.opState ?? 'merge'
    const fn =
      source === 'rebase'
        ? window.gitCity.rebaseAbort
        : source === 'cherry-pick'
          ? window.gitCity.cherryPickAbort
          : window.gitCity.mergeAbort
    return runOp(set, get, 'Aborting…', (repo) => fn(repo), {
      reanalyze: true,
      closeMerge: true
    })
  },
  continueOp: () => {
    const source = get().workingStatus?.opState ?? 'merge'
    const fn =
      source === 'rebase'
        ? window.gitCity.rebaseContinue
        : source === 'cherry-pick'
          ? window.gitCity.cherryPickContinue
          : window.gitCity.mergeContinue
    return runOp(set, get, 'Continuing…', (repo) => fn(repo), {
      reanalyze: true,
      conflictsOpenMerge: true,
      closeMergeOnSuccess: true,
      effect: 'commit-settle'
    })
  }
}))

// ---------- helpers ----------

interface RunOpts {
  reanalyze?: boolean
  effect?: EffectKind
  conflictsOpenMerge?: boolean
  closeMerge?: boolean
  closeMergeOnSuccess?: boolean
}

/** Shared plumbing for every mutating op: guard, spinner, error surfacing, refresh. */
async function runOp(
  set: (partial: Partial<GitCityState>) => void,
  get: () => GitCityState,
  label: string,
  fn: (repoPath: string) => Promise<OpResult>,
  opts: RunOpts = {}
): Promise<void> {
  const { repoPath } = get()
  if (!hasApi() || !repoPath) return
  set({ opInProgress: { label }, opError: null })
  let result: OpResult
  try {
    result = await fn(repoPath)
  } catch (err) {
    set({ opInProgress: null, opError: { message: cleanError(err) } })
    return
  }
  set({ opInProgress: null })

  await get().refreshStatus()
  await get().refreshBranches()
  await get().refreshStashes()
  await get().refreshTags()
  await get().refreshSubmodules()
  await get().refreshWorktrees()

  if (!result.ok) {
    if (result.code === 'conflict' && opts.conflictsOpenMerge) {
      const src = get().workingStatus?.opState ?? 'merge'
      set({ mergeView: { active: result.conflicts?.[0] ?? null, source: src } })
    }
    if (result.code !== 'conflict') {
      set({
        opError: { message: result.message ?? 'Operation failed.', gitOutput: result.gitOutput }
      })
    }
    return
  }

  if (opts.closeMerge || opts.closeMergeOnSuccess) set({ mergeView: null })
  if (opts.effect) triggerEffect(set, get, opts.effect)
  if (opts.reanalyze) await get().refreshAnalysis()
}

function triggerEffect(
  set: (partial: Partial<GitCityState>) => void,
  get: () => GitCityState,
  kind: EffectKind
): void {
  set({ effect: { kind, nonce: (get().effect?.nonce ?? 0) + 1 } })
}

async function loadRepo(
  set: (partial: Partial<GitCityState>) => void,
  get: () => GitCityState,
  analyze: () => Promise<RepoAnalysis>,
  path: string
): Promise<void> {
  set({ screen: 'loading', error: null, progress: null })
  try {
    const analysis = await analyze()
    lastFingerprint = ''
    // remember it, most-recent first, no duplicates
    const recent = [path, ...get().recentRepos.filter((p) => p !== path)].slice(0, RECENT_MAX)
    saveRecent(recent)
    set({
      ...REPO_STATE_RESET,
      recentRepos: recent,
      analysis,
      repoPath: path,
      snapshotIndex: Math.max(0, analysis.snapshots.length - 1),
      // a commit-less repo lands on the Changes panel — the only useful next step
      panel: analysis.snapshots.length === 0 ? 'changes' : 'none',
      screen: 'city'
    })
    if (hasApi()) {
      await window.gitCity.watchStart(path)
      await get().refreshStatus()
      await get().refreshBranches()
      await get().refreshStashes()
      await get().refreshTags()
      await get().refreshSubmodules()
      await get().refreshWorktrees()
      // GitHub is a network call — populate the PR/CI state in the background
      void get().refreshGitHub()
    }
  } catch (err) {
    set({ screen: 'welcome', error: cleanError(err) })
  }
}

/** Derived: are we viewing HEAD with a status that matches the analyzed head? */
export function isLiveState(s: GitCityState): boolean {
  const { analysis, snapshotIndex, workingStatus } = s
  if (!analysis || analysis.snapshots.length === 0) return false
  if (snapshotIndex !== analysis.snapshots.length - 1) return false
  const headSnap = analysis.snapshots[analysis.snapshots.length - 1]
  if (!workingStatus) return true
  if (!workingStatus.headHash) return true
  return workingStatus.headHash.startsWith(headSnap.hash)
}
