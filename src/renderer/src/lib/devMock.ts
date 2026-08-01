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
import { hasApi, useStore } from '../store'

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

function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildAnalysis(): RepoAnalysis {
  const rand = mulberry32(20260718)
  const authors = ['Alice', 'Bob', 'Chen', 'Dana']
  const fileCount = mockFileCount()

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
      files.push({
        path: f.path,
        loc: Math.max(5, Math.floor(f.peak * Math.min(1, age * 1.4))),
        commits: 1 + Math.floor(age * 40 * ((f.peak % 7) / 6 + 0.2)),
        lastTouched: commitDate(s),
        lastAuthor: authors[(f.peak + s) % authors.length],
        binary: false
      })
    }
    snapshots.push({
      hash: `mock${s.toString(16).padStart(4, '0')}${'0'.repeat(32)}`,
      date: commitDate(s),
      author: authors[s % authors.length],
      message: `mock commit ${s + 1}: grow the city`,
      index: s,
      files
    })
  }

  return {
    info: {
      name: 'mock-repo',
      path: 'C:/mock/mock-repo',
      branch: 'main',
      commitCount: SNAPSHOT_COUNT
    },
    snapshots
  }
}

function buildStatus(analysis: RepoAnalysis): WorkingStatus {
  const head = analysis.snapshots[analysis.snapshots.length - 1]
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
      gitVersion: 'mock'
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
