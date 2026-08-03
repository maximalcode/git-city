import { create } from 'zustand'
import type {
  BranchInfo,
  GitVersion,
  HostAuth,
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
  UpdateInfo,
  WorkingStatus,
  WorktreeInfo
} from '../../shared/types'
import { DEFAULT_THEME_ID } from './city/themes'
import { DEFAULT_MODE, isViewMode, type ViewMode } from './city/modes'
import { repoWarning, type RepoWarning } from './lib/repoScale'
import { opMessage } from '../../shared/opMessages'
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

export type { ViewMode }
const VIEW_KEY = 'gitcity.view'
function loadViewMode(): ViewMode {
  try {
    // validated against the registry, so a mode removed in a later version
    // falls back instead of persisting a value nothing can render
    const v = localStorage.getItem(VIEW_KEY)
    return isViewMode(v) ? v : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
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

const SUNFOLLOW_KEY = 'gitcity.sunfollow'
function loadSunFollows(): boolean {
  try {
    // default ON: the sky tracking the commit clock is the intended first look
    return localStorage.getItem(SUNFOLLOW_KEY) !== '0'
  } catch {
    return true
  }
}
function saveSunFollows(on: boolean): void {
  try {
    localStorage.setItem(SUNFOLLOW_KEY, on ? '1' : '0')
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
/**
 * Defaults to the OS setting until the user says otherwise. Someone who has
 * asked their whole system for less motion should not have to find a checkbox
 * in here as well — and once they do touch it, their choice is what persists.
 */
function loadReduceMotion(): boolean {
  try {
    const stored = localStorage.getItem(REDUCEMOTION_KEY)
    if (stored !== null) return stored === 'on'
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
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
  statusError: null,
  branches: [],
  stashes: [],
  tags: [],
  submodules: [],
  worktrees: [],
  hostAuth: null,
  pullRequests: [],
  prsTruncated: false,
  hostError: null,
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
  /** a repo big enough to be worth warning about, awaiting the user's go-ahead */
  pendingRepo: { path: string; warning: RepoWarning } | null
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
  /** 'checking' until the probe answers; null means git is not on PATH at all */
  gitVersion: GitVersion | null | 'checking'
  /** the repository being size-probed before opening, so Welcome can say so */
  pendingProbe: string | null
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
  hostAuth: HostAuth | null
  pullRequests: PullRequestInfo[]
  /** more open PRs exist than the panel asked for */
  prsTruncated: boolean
  /** why the PR list could not be fetched — never confused with "there are none" */
  hostError: string | null
  currentPr: PullRequestInfo | null
  prPanelOpen: boolean
  prLoading: boolean
  /** a newer release found on GitHub, or null; dismissed for the session once closed */
  update: UpdateInfo | null
  /**
   * State of a user-initiated update check. It exists only so the button can
   * say something: pressing it was a silent no-op when you were already
   * current or offline, so you could not tell whether the check ran (#26).
   */
  updateCheck: 'idle' | 'checking' | 'checked'
  /**
   * PR being visually reviewed in the scene (its changed files glow), or null.
   * `error` set means the file list could not be fetched — the banner says so
   * instead of claiming the PR changes nothing (#24).
   */
  review: { number: number; title: string; paths: string[]; error: string | null } | null
  reviewLoading: boolean
  /** time-lapse recording in progress */
  exporting: boolean
  /** last export error message (e.g. unsupported), shown briefly */
  exportError: string | null
  rebaseOpen: boolean
  reflogOpen: boolean
  panel: Panel
  /**
   * The running op. `cancellable` is only true for the network ops that
   * actually honour cancelCurrentOp — the HUD used to offer Cancel for every
   * op, and clicking it during a submodule update or a rebase did precisely
   * nothing while the whole UI stayed disabled (#26).
   */
  opInProgress: { label: string; cancellable: boolean } | null
  /**
   * Why the working tree could not be read. Never confused with "the tree is
   * clean" — the panel shows an error with a Retry instead of an empty list.
   */
  statusError: string | null
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
  /** when true, the sun tracks the current commit's local hour instead of the
   *  manual slider; moving the slider turns this off. Global pref, default on. */
  sunFollowsCommit: boolean
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
  confirmPendingRepo(): Promise<void>
  cancelPendingRepo(): void
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
  toggleSunFollowsCommit(): void
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
  refreshHost(): Promise<void>
  checkoutPr(number: number): Promise<void>
  createPr(base: string, title: string, body: string): Promise<void>
  reviewPrInCity(number: number, title: string): Promise<void>
  clearReview(): void
  openExternal(url: string): void
  /** `manual` = the user pressed the button, so the result is worth showing. */
  checkForUpdate(manual?: boolean): Promise<void>
  dismissUpdate(): void
  startExport(): void
  endExport(error?: string | null): void
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
  applyLines(path: string, header: string, lineIndices: number[], mode: HunkMode): Promise<void>
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
  pendingRepo: null,
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
  gitVersion: 'checking',
  pendingProbe: null,
  recentRepos: loadRecent(),
  searchOpen: false,

  repoPath: null,
  workingStatus: null,
  branches: [],
  stashes: [],
  tags: [],
  submodules: [],
  worktrees: [],
  hostAuth: null,
  pullRequests: [],
  prsTruncated: false,
  hostError: null,
  currentPr: null,
  prPanelOpen: false,
  prLoading: false,
  rebaseOpen: false,
  reflogOpen: false,
  panel: 'none',
  opInProgress: null,
  statusError: null,
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
  sunFollowsCommit: loadSunFollows(),
  showHotspots: loadShowHotspots(),
  diffSplit: loadDiffSplit(),
  reduceMotion: loadReduceMotion(),
  settingsOpen: false,
  update: null,
  updateCheck: 'idle',
  review: null,
  reviewLoading: false,
  exporting: false,
  exportError: null,
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
        // "This branch" otherwise keeps showing the PR of the branch just
        // left — and that PR is filtered out of the Open list, so it appears
        // in the wrong place and nowhere else. Conversely, after checking out
        // a PR's branch the stale null offered "Create PR" for a branch that
        // already has one (#24). Only for users who have opened the panel;
        // nobody else should pay for a gh spawn on every checkout.
        const st = get()
        if (st.prPanelOpen || st.hostAuth !== null) void st.refreshHost()
        // external HEAD move: don't surprise-reanalyze; offer a reload pill
        const s = get()
        if (s.opInProgress === null && s.reanalyzing === false) {
          // ...unless there is no scene to disturb. A repo with no commits
          // renders EmptyRepoView, which carries no reload affordance, so a
          // first commit made outside the app left "No commits yet" on screen
          // indefinitely while the Changes panel beside it showed a clean tree.
          // Only closing and reopening the repository fixed it (#29).
          if ((s.analysis?.snapshots.length ?? 0) === 0) void s.refreshAnalysis()
          else set({ historyStale: true })
        }
      }
    })
    window.gitCity
      .checkGit()
      .then((v) => set({ gitVersion: v }))
      .catch(() => set({ gitVersion: null }))
    // one-shot update check at startup (fails soft when offline)
    void get().checkForUpdate()
  },

  openLocal: async () => {
    if (!hasApi()) return
    const path = await window.gitCity.selectFolder()
    if (!path) return
    await get().openPath(path)
  },

  openPath: async (path: string) => {
    if (!hasApi()) return
    // Probe the size first: a monorepo can take minutes to replay, and a
    // progress bar with no sense of scale reads as a hang (#12). Cheap enough
    // (two counting calls) that the common case is unaffected.
    //
    // pendingProbe is what Welcome shows during it. The counting is fast on a
    // normal repo and slow on exactly the repos this exists to warn about, and
    // with nothing on screen the user clicked Open a second time and got a
    // second folder dialog (#25).
    set({ pendingProbe: path, error: null })
    try {
      const warning = repoWarning(await window.gitCity.repoSize(path))
      if (warning) {
        set({ pendingRepo: { path, warning } })
        return
      }
    } catch {
      // if sizing fails, just open — never block on the advisory path
    } finally {
      set({ pendingProbe: null })
    }
    await loadRepo(set, get, () => window.gitCity.analyzeRepo(path, 50), path)
  },

  confirmPendingRepo: async () => {
    const pending = get().pendingRepo
    if (!pending) return
    set({ pendingRepo: null })
    await loadRepo(set, get, () => window.gitCity.analyzeRepo(pending.path, 50), pending.path)
  },

  cancelPendingRepo: () => set({ pendingRepo: null }),

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
    // grabbing the slider means "I want manual control" — stop tracking commits
    saveSunFollows(false)
    set({ timeOfDay, sunFollowsCommit: false })
  },
  toggleSunFollowsCommit: () => {
    const sunFollowsCommit = !get().sunFollowsCommit
    saveSunFollows(sunFollowsCommit)
    set({ sunFollowsCommit })
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
      SUNFOLLOW_KEY,
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
      sunFollowsCommit: true,
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
      if (get().statusError !== null) set({ statusError: null })
      if (fp === lastFingerprint) return
      lastFingerprint = fp
      set({ workingStatus: status })
      // conflicts appeared while a merge view is open → nothing to do; gone → maybe close
    } catch (err) {
      // Swallowed entirely before, so a corrupt index or a repo folder that
      // went away mid-session left the Changes panel showing "Staged (0) /
      // Changes (0)" with a blank list — which reads as a clean tree (#26).
      set({ statusError: cleanError(err) })
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
    if (prPanelOpen) void get().refreshHost()
  },
  refreshHost: async () => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    set({ prLoading: true, hostError: null })
    // A slow gh call from the previous repository could otherwise land in the
    // new one's panel, offering "Check out" for a PR number that doesn't exist
    // there (#29).
    const stillHere = (): boolean => get().repoPath === repoPath
    try {
      const auth = await window.gitCity.hostStatus(repoPath)
      if (!stillHere()) return
      if (!auth.authed || !auth.isRepo) {
        set({ hostAuth: auth, pullRequests: [], currentPr: null, prsTruncated: false })
        return
      }
      const [list, currentPr] = await Promise.all([
        window.gitCity.listPullRequests(repoPath),
        window.gitCity.currentBranchPr(repoPath)
      ])
      if (!stillHere()) return
      // A failed list is not an empty list. Rendering it as "No open pull
      // requests" was a confident lie about a repo with forty of them (#24).
      if (!list.ok) {
        set({ hostAuth: auth, currentPr, hostError: list.reason })
        return
      }
      set({
        hostAuth: auth,
        pullRequests: list.prs,
        prsTruncated: list.more,
        currentPr,
        hostError: null
      })
    } catch (err) {
      // Swallowing this left the panel completely blank — no message, no empty
      // state, and a ↻ that visibly did nothing (#24).
      if (stillHere()) set({ hostError: cleanError(err) })
    } finally {
      if (stillHere()) set({ prLoading: false })
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
    if (!get().opError) await get().refreshHost()
  },
  reviewPrInCity: async (number, title) => {
    const { repoPath } = get()
    if (!hasApi() || !repoPath) return
    set({ reviewLoading: true, prPanelOpen: false })
    const stillHere = (): boolean => get().repoPath === repoPath
    try {
      const res = await window.gitCity.pullRequestFiles(repoPath, number)
      if (!stillHere()) return
      // "Reviewing #42 — 0 files" was asserted whenever the fetch failed: a
      // confident claim that the PR changes nothing (#24).
      set(
        res.ok
          ? { review: { number, title, paths: res.files.map((f) => f.path), error: null } }
          : { review: { number, title, paths: [], error: res.reason } }
      )
    } catch (err) {
      if (stillHere()) set({ review: { number, title, paths: [], error: cleanError(err) } })
    } finally {
      if (stillHere()) set({ reviewLoading: false })
    }
  },
  clearReview: () => set({ review: null }),
  openExternal: (url) => {
    if (hasApi()) void window.gitCity.openExternal(url)
  },
  checkForUpdate: async (manual = false) => {
    if (!hasApi()) return
    // Only a check the user asked for reports itself. The startup one is
    // deliberately invisible — it must not make the Settings button read
    // "No update found" before anyone has pressed it.
    if (manual) set({ updateCheck: 'checking' })
    try {
      const update = await window.gitCity.checkForUpdate()
      if (update) set({ update })
    } catch {
      /* offline / rate-limited — the main process already fails soft */
    } finally {
      if (manual) set({ updateCheck: 'checked' })
    }
  },
  dismissUpdate: () => set({ update: null }),
  startExport: () => {
    if (!get().exporting) set({ exporting: true, exportError: null })
  },
  endExport: (error = null) => set({ exporting: false, exportError: error }),

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
    set({ opInProgress: { label: 'Rebasing…', cancellable: false }, opError: null })
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
    // Decided up front, and from the timeline alone.
    //
    // isLiveState() also compares the working tree's headHash against the newest
    // snapshot, which is right for its other callers and guaranteed wrong here:
    // runOp refreshes the status before it reanalyses, so by this point headHash
    // is already the commit we are about to add. Asked afterwards it answered
    // "not live" for every commit, and left the user one snapshot in the past —
    // timeline a notch short, "Viewing history" banner up, live working-tree
    // layer switched off, immediately after committing.
    const before = get()
    const wasLive =
      !before.analysis ||
      before.analysis.snapshots.length === 0 ||
      before.snapshotIndex === before.analysis.snapshots.length - 1
    set({ reanalyzing: true, historyStale: false })
    try {
      let analysis = await window.gitCity.analyzeIncremental(repoPath)
      if (!analysis) analysis = await window.gitCity.analyzeRepo(repoPath, 50)
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
  applyLines: (path, header, lineIndices, mode) => {
    const n = lineIndices.length
    const label =
      mode === 'stage'
        ? `Staging ${n} line${n === 1 ? '' : 's'}…`
        : mode === 'unstage'
          ? `Unstaging ${n} line${n === 1 ? '' : 's'}…`
          : `Discarding ${n} line${n === 1 ? '' : 's'}…`
    return runOp(set, get, label, (repo) =>
      window.gitCity.applyLines(repo, path, header, lineIndices, mode)
    )
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
  // cancellable: these three go through simple-git with an AbortSignal, so
  // cancelCurrentOp actually stops them. Nothing else does (#26).
  fetch: () =>
    runOp(set, get, 'Fetching…', (repo) => window.gitCity.fetch(repo), { cancellable: true }),
  pull: () =>
    runOp(set, get, 'Pulling…', (repo) => window.gitCity.pull(repo), {
      cancellable: true,
      reanalyze: true,
      effect: 'pull',
      conflictsOpenMerge: true
    }),
  push: (setUpstream) =>
    runOp(set, get, 'Pushing…', (repo) => window.gitCity.push(repo, setUpstream), {
      cancellable: true,
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
  /** the op honours cancelCurrentOp — fetch/pull/push only */
  cancellable?: boolean
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
  set({ opInProgress: { label, cancellable: opts.cancellable === true }, opError: null })
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
    if (shouldSurfaceError(result.code, opts.conflictsOpenMerge === true)) {
      // opMessage, not result.message: for the codes we recognise, git's own
      // first line is written for someone mid-task in a terminal and reads
      // badly in a toast with no context (#26).
      set({ opError: { message: opMessage(result), gitOutput: result.gitOutput } })
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
      review: null,
      reviewLoading: false,
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
      void get().refreshHost()
    }
  } catch (err) {
    set({ screen: 'welcome', error: cleanError(err) })
  }
}

/**
 * Should a failed operation put a message on screen?
 *
 * A 'conflict' failure is only *handled* when the merge view opens to deal
 * with it. Swallowing every conflict-coded failure made Commit a spinner that
 * appeared, disappeared and changed nothing, and let "Stash & switch" promise
 * a stash it had never made (#26).
 */
export function shouldSurfaceError(code: OpResult['code'], conflictsOpenMerge: boolean): boolean {
  return !(code === 'conflict' && conflictsOpenMerge)
}

/** Derived: are we viewing HEAD with a status that matches the analyzed head? */
export function isLiveState(s: GitCityState): boolean {
  const { analysis, snapshotIndex, workingStatus } = s
  if (!analysis) return false
  // A repository with no commits has no history to browse, so it is always at
  // "now" — answering false put a "Viewing history — Jump to now" banner on the
  // Changes panel of a fresh `git init`, offering to jump to a snapshot that
  // does not exist (#27).
  if (analysis.snapshots.length === 0) return true
  if (snapshotIndex !== analysis.snapshots.length - 1) return false
  const headSnap = analysis.snapshots[analysis.snapshots.length - 1]
  if (!workingStatus) return true
  if (!workingStatus.headHash) return true
  return workingStatus.headHash.startsWith(headSnap.hash)
}
