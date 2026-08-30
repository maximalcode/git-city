/**
 * Browser-preview mock: lets the renderer run without Electron or git so the
 * scene can be verified visually (vite preview on :5199). Activated only
 * in DEV builds, only when the preload API is absent, and only with `?mock` in
 * the URL — the plain preview still boots to the welcome screen. `?mock=20000`
 * scales the synthetic repo up for performance work.
 *
 * Deterministic on purpose: the same synthetic repo every load makes visual
 * regressions comparable across sessions.
 */
import type { FileState, RepoAnalysis, Snapshot, WorkingStatus } from '../../../shared/types'
import { buildAnalysis as compactAnalysis, materializeSnapshot } from '../../../shared/snapshots'
import { hasApi } from './bridge'
import { useStore } from '../store'

const DIRS = [
  'src/core',
  'src/core/render',
  'src/core/layout',
  'src/ui',
  'src/ui/panels',
  'src/lib',
  'main/git',
  'main',
  'test',
  'docs',
  ''
]
const EXTS = ['ts', 'tsx', 'ts', 'ts', 'css', 'md', 'json']

const DEFAULT_FILE_COUNT = 250
const SNAPSHOT_COUNT = 30

/**
 * `?mock` gives the standard 250-file repo; `?mock=20000` scales it up, which
 * is how the scene gets measured against monorepo-sized inputs without cloning
 * one (see the analysis-side probe in src/main/git/perf.test.ts).
 */
function mockFileCount(): number {
  const raw = new URLSearchParams(window.location.search).get('mock')
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FILE_COUNT
}

/**
 * The synthetic repository, without a browser.
 *
 * Exported so scene-build cost can be measured in Node against the same input
 * the preview draws — see `city/sceneBuildPerf.test.ts`. Measuring it through
 * an automated browser produces fiction: the pane is hidden, so rAF is
 * suspended and react-three-fiber never commits (#82).
 */
export function buildMockAnalysis(fileCount: number): RepoAnalysis {
  return buildAnalysisOf(fileCount)
}

function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Commit subjects for the synthetic repository.
 *
 * These are read in the README screenshots, in the playback ticker and in the
 * command palette, so they have to look like somebody's actual afternoon.
 * "mock commit 30: grow the city" was fine while nothing looked at them.
 */
const MESSAGES = [
  'Initial commit',
  'Add the render loop and a first pass at the frame graph',
  'Split layout out of the renderer',
  'Cache the tessellation between frames',
  'Fix the off-by-one in the row iterator',
  'Add unit tests for the layout pass',
  'Wire up the settings panel',
  'Extract the shader preamble into its own module',
  'Handle an empty document without dividing by zero',
  'Speed up the hit test with a coarse grid',
  'Add keyboard navigation to the sidebar',
  'Document the plugin surface',
  'Drop the dead code path behind the old flag',
  'Fix the flicker when resizing quickly',
  'Move the parser into its own worker',
  'Add a progress indicator for slow loads',
  'Tighten the error message on a bad config',
  'Refactor the state store into slices',
  'Support nested groups in the outline',
  'Fix a leak in the texture pool',
  'Reduce the bundle by lazy-loading the editor',
  'Add a dark theme',
  'Persist window size between sessions',
  'Fix the crash on a zero-length selection',
  'Batch the layout invalidations',
  'Add an escape hatch for custom renderers',
  'Warn instead of throwing on an unknown field',
  'Update the contributing guide',
  'Cut the startup time by deferring the index',
  'Prepare the release'
]

/** Deterministic 40-hex hash. Its own stream, so the layout draw order is untouched. */
function commitHash(index: number): string {
  const r = mulberry32(0x5eed + index * 7919)
  let out = ''
  while (out.length < 40)
    out += Math.floor(r() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  return out.slice(0, 40)
}

function buildAnalysis(): RepoAnalysis {
  return buildAnalysisOf(mockFileCount())
}

function buildAnalysisOf(fileCount: number): RepoAnalysis {
  const rand = mulberry32(20260718)
  const authors = ['Marta Ellis', 'Sam Okonjo', 'Ruth Vasquez', 'Theo Lindqvist']

  interface SeedFile {
    path: string
    birth: number // snapshot index the file appears in
    peak: number // LOC it grows toward
  }
  const seeds: SeedFile[] = []
  for (let i = 0; i < fileCount; i++) {
    const dir = DIRS[Math.floor(rand() * DIRS.length)]
    const ext = EXTS[Math.floor(rand() * EXTS.length)]
    const name = `file${i.toString(36)}.${ext}`
    seeds.push({
      path: dir ? `${dir}/${name}` : name,
      birth: Math.floor(Math.pow(rand(), 1.6) * SNAPSHOT_COUNT * 0.85),
      peak: 20 + Math.floor(Math.pow(rand(), 2.5) * 4000)
    })
  }

  const base = 1735689600000 // 2025-01-01 (ms, matching the analyzer)
  // spread commit times across the day so "sky follows commit time" is visible:
  // a deterministic hour walk that sweeps morning → night as the city grows
  const commitDate = (s: number): number => {
    const day = base + s * 86400_000 * 9
    const hour = 6 + ((s * 5) % 18) // 06:00 → 23:00, wrapping
    return day + hour * 3600_000
  }
  const snapshots: Snapshot[] = []
  for (let s = 0; s < SNAPSHOT_COUNT; s++) {
    const files: FileState[] = []
    for (const f of seeds) {
      if (f.birth > s) continue
      const age = (s - f.birth + 1) / (SNAPSHOT_COUNT - f.birth + 1)
      // Every file used to carry the current commit's date, which made every
      // file in the mock equally recent — so the Recency mode could not be
      // looked at in the preview at all. Files now go quiet at different
      // points: a deterministic per-file lag, larger for the ones a real
      // repository leaves alone.
      const quiet = (f.peak % 11) + (f.path.length % 5)
      const touched = Math.max(f.birth, s - quiet)
      files.push({
        path: f.path,
        loc: Math.max(5, Math.floor(f.peak * Math.min(1, age * 1.4))),
        commits: 1 + Math.floor(age * 40 * ((f.peak % 7) / 6 + 0.2)),
        lastTouched: commitDate(touched),
        lastAuthor: authors[(f.peak + touched) % authors.length],
        binary: false
      })
    }
    snapshots.push({
      hash: commitHash(s),
      date: commitDate(s),
      author: authors[s % authors.length],
      message: MESSAGES[s % MESSAGES.length],
      index: s,
      files
    })
  }

  return compactAnalysis(
    {
      name: 'atlas',
      path: '/Users/dev/code/atlas',
      branch: 'main',
      commitCount: SNAPSHOT_COUNT
    },
    snapshots
  )
}

function buildStatus(analysis: RepoAnalysis): WorkingStatus {
  const head = materializeSnapshot(analysis, analysis.snapshots.length - 1)
  const paths = head.files.map((f) => f.path)
  return {
    branch: 'main',
    detachedAt: null,
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    files: [
      { path: paths[3], index: 'unmodified', worktree: 'modified', conflicted: false },
      { path: paths[10], index: 'modified', worktree: 'unmodified', conflicted: false },
      { path: paths[17], index: 'unmodified', worktree: 'modified', conflicted: false },
      {
        path: 'src/ui/brand-new.tsx',
        index: 'unmodified',
        worktree: 'untracked',
        conflicted: false
      }
    ],
    opState: 'none',
    stashCount: 1,
    remotes: [{ name: 'origin', url: 'https://example.invalid/mock-repo.git' }],
    headHash: head.hash
  }
}

export function installDevMock(): void {
  if (!import.meta.env.DEV || hasApi()) return
  const load = (): void => {
    const analysis = buildAnalysis()
    useStore.setState({
      screen: 'city',
      analysis,
      snapshotIndex: analysis.snapshots.length - 1,
      workingStatus: buildStatus(analysis),
      repoPath: 'C:/mock/mock-repo',
      gitVersion: { raw: 'git version 2.45.0 (mock)', parts: [2, 45], supported: true }
    })
  }
  // store handle included so browser-automation checks can drive selection
  // directly (synthetic PointerEvents can't carry offsetX/Y, which r3f's
  // raycaster reads — real mouse input is unaffected)
  ;(window as unknown as Record<string, unknown>).__gitCityMock = { load, store: useStore }
  if (new URLSearchParams(window.location.search).has('mock')) {
    // defer past the welcome screen's first layout (mounting the Canvas during
    // the initial layout pass races r3f's resize measurement — the real app
    // flow always mounts it much later), then belt-and-braces a resize kick so
    // the canvas is correctly sized even in throttled/automated tabs
    setTimeout(load, 100)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 600)
  }
}
