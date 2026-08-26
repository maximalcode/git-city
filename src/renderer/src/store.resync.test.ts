import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitCityApi, RepoAnalysis, WorkingStatus } from '../../shared/types'
import { setBridge } from './lib/bridge'
import { useStore } from './store'

/**
 * The first tests of the store itself.
 *
 * They exist because `bridge()` can be handed a fake (#106) — before that the
 * store closed over the global `window.gitCity`, so there was nothing to
 * inject and nothing here could be written at all.
 */

let head = 0
function status(): WorkingStatus {
  // a fresh headHash per call: refreshStatus skips work when the fingerprint
  // is unchanged, and this module-level memory outlives a single test
  head += 1
  return {
    branch: 'main',
    detachedAt: null,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [],
    opState: 'none',
    stashCount: 0,
    remotes: [],
    headHash: `hash${head}`
  }
}

const EMPTY_ANALYSIS = { snapshots: [], files: [] } as unknown as RepoAnalysis

/** Records every method called on it; `overrides` decide what they answer. */
function fakeBridge(overrides: Record<string, (...args: never[]) => unknown> = {}): {
  api: GitCityApi
  calls: string[]
} {
  const calls: string[] = []
  const defaults: Record<string, unknown> = {
    status: undefined, // filled per call below
    branches: [{ name: 'main', current: true }],
    stashList: [{ index: 0, message: 'wip' }],
    tags: [{ name: 'v1' }],
    submodules: [{ path: 'vendor/x' }],
    worktrees: [{ path: '/repo' }],
    analyzeIncremental: EMPTY_ANALYSIS
  }
  const api = new Proxy(
    {},
    {
      get:
        (_t, prop: string) =>
        (...args: never[]): unknown => {
          calls.push(prop)
          const override = overrides[prop]
          if (override) return override(...args)
          if (prop === 'status') return Promise.resolve(status())
          return Promise.resolve(prop in defaults ? defaults[prop] : { ok: true })
        }
    }
  )
  return { api: api as GitCityApi, calls }
}

beforeEach(() => {
  useStore.setState({
    repoPath: '/repo',
    workingStatus: null,
    branches: [],
    stashes: [],
    tags: [],
    submodules: [],
    worktrees: [],
    opError: null,
    opInProgress: null,
    mergeView: null,
    rebaseOpen: true,
    analysis: null
  })
})

afterEach(() => setBridge(null))

describe('resync', () => {
  it('reloads every view', async () => {
    const { api } = fakeBridge()
    setBridge(api)

    await useStore.getState().resync()

    const s = useStore.getState()
    expect(s.workingStatus?.branch).toBe('main')
    expect(s.branches).toHaveLength(1)
    expect(s.stashes).toHaveLength(1)
    expect(s.tags).toHaveLength(1)
    expect(s.submodules).toHaveLength(1)
    expect(s.worktrees).toHaveLength(1)
  })

  it('reloads only the views it was asked for', async () => {
    const { api, calls } = fakeBridge()
    setBridge(api)

    await useStore.getState().resync(['branches', 'tags'])

    expect(calls).toEqual(['branches', 'tags'])
    expect(useStore.getState().tags).toHaveLength(1)
    expect(useStore.getState().stashes).toEqual([])
  })

  it('keeps going when one view fails, and says nothing about it', async () => {
    const { api } = fakeBridge({
      worktrees: () => Promise.reject(new Error('git worktree list exploded'))
    })
    setBridge(api)

    await useStore.getState().resync()

    const s = useStore.getState()
    expect(s.branches).toHaveLength(1)
    expect(s.worktrees).toEqual([])
    // a failed background view must not replace the outcome of what the user did
    expect(s.opError).toBeNull()
    expect(s.statusError).toBeNull()
  })

  it('reports an unreadable working tree, which is not the same as a clean one', async () => {
    const { api } = fakeBridge({ status: () => Promise.reject(new Error('index is corrupt')) })
    setBridge(api)

    await useStore.getState().resync(['status'])

    expect(useStore.getState().statusError).toBe('index is corrupt')
  })

  it('does nothing with no repository open', async () => {
    const { api, calls } = fakeBridge()
    setBridge(api)
    useStore.setState({ repoPath: null })

    await useStore.getState().resync()

    expect(calls).toEqual([])
  })
})

describe('runOp', () => {
  it('hands back the result instead of making callers watch opError', async () => {
    const { api } = fakeBridge({ stage: () => Promise.resolve({ ok: true }) })
    setBridge(api)

    const result = await useStore.getState().stage(['a.ts'])

    expect(result.ok).toBe(true)
    expect(useStore.getState().opError).toBeNull()
  })

  it('hands back the failure, with the code the main process decided', async () => {
    const { api } = fakeBridge({
      deleteBranch: () =>
        Promise.resolve({ ok: false, code: 'not-merged', message: 'raw git text' })
    })
    setBridge(api)

    const result = await useStore.getState().deleteBranch('feature', false)

    expect(result).toMatchObject({ ok: false, code: 'not-merged' })
  })

  it('resyncs every view once the op lands', async () => {
    const { api, calls } = fakeBridge()
    setBridge(api)

    await useStore.getState().stage(['a.ts'])

    expect(calls).toContain('status')
    expect(calls).toContain('branches')
    expect(calls).toContain('stashList')
    expect(calls).toContain('tags')
    expect(calls).toContain('submodules')
    expect(calls).toContain('worktrees')
  })

  it('shows the curated sentence, not what git printed', async () => {
    const { api } = fakeBridge({
      push: () =>
        Promise.resolve({ ok: false, code: 'rejected', message: 'To github.com:you/x.git' })
    })
    setBridge(api)

    await useStore.getState().push(false)

    expect(useStore.getState().opError?.message).toBe(
      "The remote has commits you don't have yet. Pull first, then push again."
    )
  })

  it('carries the failure code through to opError so the UI can react', async () => {
    const { api } = fakeBridge({
      deleteBranch: () =>
        Promise.resolve({ ok: false, code: 'not-merged', message: 'raw git text' })
    })
    setBridge(api)

    await useStore.getState().deleteBranch('feature', false)

    expect(useStore.getState().opError?.code).toBe('not-merged')
    expect(useStore.getState().opError?.message).toBeTruthy()
  })

  it('never ran with no repository open', async () => {
    const { api, calls } = fakeBridge()
    setBridge(api)
    useStore.setState({ repoPath: null })

    const result = await useStore.getState().stage(['a.ts'])

    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
    expect(useStore.getState().opInProgress).toBeNull()
  })
})

/**
 * runInteractiveRebase used to be a copy of runOp, and the copy had drifted:
 * two views of six, git's raw text instead of the curated sentence, and its
 * own inlined copy of shouldSurfaceError (#107).
 */
describe('runInteractiveRebase', () => {
  it('resyncs the views a rebase can invalidate, not just two of them', async () => {
    const { api, calls } = fakeBridge({ rebaseInteractive: () => Promise.resolve({ ok: true }) })
    setBridge(api)

    await useStore.getState().runInteractiveRebase(null, [])

    // dropping a commit can orphan a stash, a tag or a submodule pointer
    expect(calls).toContain('stashList')
    expect(calls).toContain('tags')
    expect(calls).toContain('submodules')
    expect(calls).toContain('worktrees')
    expect(useStore.getState().rebaseOpen).toBe(false)
  })

  it('shows the curated sentence for a coded failure', async () => {
    const { api } = fakeBridge({
      rebaseInteractive: () =>
        Promise.resolve({ ok: false, code: 'dirty', message: 'error: cannot rebase: You have...' })
    })
    setBridge(api)

    const result = await useStore.getState().runInteractiveRebase(null, [])

    expect(result.ok).toBe(false)
    expect(useStore.getState().opError?.message).toBe('Commit or stash your local changes first.')
    // the failure left the todo list up, to fix and retry
    expect(useStore.getState().rebaseOpen).toBe(true)
  })

  it('hands a conflict to the merge view without also raising a toast', async () => {
    const { api } = fakeBridge({
      rebaseInteractive: () =>
        Promise.resolve({ ok: false, code: 'conflict', conflicts: ['a.ts'] }),
      // git leaves .git/rebase-merge behind, so the refreshed status says so —
      // which is where the merge view's source comes from now that this goes
      // through runOp, instead of the hardcoded 'rebase' the copy carried
      status: () => Promise.resolve({ ...status(), opState: 'rebase' })
    })
    setBridge(api)

    await useStore.getState().runInteractiveRebase(null, [])

    expect(useStore.getState().mergeView).toEqual({ active: 'a.ts', source: 'rebase' })
    expect(useStore.getState().opError).toBeNull()
    expect(useStore.getState().rebaseOpen).toBe(false)
  })
})
