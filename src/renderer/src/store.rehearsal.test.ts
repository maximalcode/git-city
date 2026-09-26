import { afterEach, expect, it, vi } from 'vitest'
import type { GitCityApi, RehearsalResult, RehearsalReport } from '../../shared/types'
import { setBridge } from './lib/bridge'
import { useStore } from './store'

afterEach(() => {
  setBridge(null)
  useStore.setState({
    repoPath: null,
    rehearsalBusy: false,
    rehearsalOpen: false,
    rehearsalResults: {}
  })
})

it('uses the bridge once and keeps a refusal visible after closing, without a direct merge fallback', async () => {
  const result: RehearsalResult = { kind: 'refused', message: 'Unsupported repository' }
  const rehearseMerge = vi.fn().mockResolvedValue(result)
  const merge = vi.fn()
  setBridge({ rehearseMerge, merge } as unknown as GitCityApi)
  useStore.setState({ repoPath: '/original' })
  useStore.getState().openRehearsal()
  await useStore.getState().rehearseMerge('topic')
  useStore.getState().closeRehearsal()
  useStore.getState().openRehearsal()
  expect(rehearseMerge).toHaveBeenCalledExactlyOnceWith('/original', 'topic')
  expect(merge).not.toHaveBeenCalled()
  expect(useStore.getState().rehearsalResults['/original']).toEqual(result)
})

it('keeps a late result on its original worktree and prevents duplicate starts', async () => {
  let finish!: (result: RehearsalResult) => void
  const rehearseMerge = vi.fn().mockImplementation(
    () =>
      new Promise<RehearsalResult>((resolve) => {
        finish = resolve
      })
  )
  setBridge({ rehearseMerge } as unknown as GitCityApi)
  useStore.setState({ repoPath: '/first' })
  const pending = useStore.getState().rehearseMerge('topic')
  useStore.getState().closeRehearsal()
  useStore.getState().openRehearsal()
  expect(useStore.getState().rehearsalOpen).toBe(true)
  await useStore.getState().rehearseMerge('topic')
  useStore.setState({ repoPath: '/second' })
  finish({ kind: 'error', message: 'Execution interrupted' })
  await pending
  expect(rehearseMerge).toHaveBeenCalledTimes(1)
  expect(useStore.getState().rehearsalResults['/second']).toBeUndefined()
  expect(useStore.getState().rehearsalResults['/first'].kind).toBe('error')
  expect(useStore.getState().rehearsalBusy).toBe(false)
})

it('queries recovery after an IPC response loss and never repeats Apply', async () => {
  const recovery = {
    state: 'none',
    repository: '/original',
    can_complete: false,
    can_rollback: false,
    message: 'clear'
  }
  const rehearsalApply = vi.fn().mockRejectedValue(new Error('Lost response'))
  const rehearsalRecovery = vi.fn().mockResolvedValue(recovery)
  const resync = vi.fn().mockResolvedValue(undefined)
  const refreshAnalysis = vi.fn().mockResolvedValue(undefined)
  setBridge({ rehearsalApply, rehearsalRecovery } as unknown as GitCityApi)
  const originalResync = useStore.getState().resync
  const originalRefresh = useStore.getState().refreshAnalysis
  const identity: RehearsalReport = {
    schema: 1,
    command: ['merge', 'topic'],
    checkout: { kind: 'branch', target: 'main' },
    pre_state: {},
    lifecycle: 'kept',
    outcome: 'clean',
    conflicted: false,
    refs: [],
    conflicts: [],
    drift: [],
    drift_unexpected: false,
    id: 'exact-id',
    repository: '/original',
    origin_worktree: '/original',
    repository_id: '/common'
  }
  useStore.setState({ repoPath: '/original', rehearsalApplications: {}, resync, refreshAnalysis })
  try {
    await useStore.getState().applyRehearsal(identity)
    await useStore.getState().applyRehearsal(identity)
    expect(rehearsalApply).toHaveBeenCalledExactlyOnceWith(identity)
    expect(rehearsalRecovery).toHaveBeenCalledExactlyOnceWith('/original')
    expect(useStore.getState().rehearsalApplications['/original']['exact-id'].kind).toBe(
      'uncertain'
    )
    expect(resync).toHaveBeenCalledOnce()
    // CLI IDs are scoped to their origin, not globally unique across repositories.
    useStore.setState({ repoPath: '/second' })
    await useStore.getState().applyRehearsal({
      ...identity,
      repository: '/second',
      origin_worktree: '/second',
      repository_id: '/second/.git'
    })
    expect(rehearsalApply).toHaveBeenCalledTimes(2)
    expect(useStore.getState().rehearsalApplications['/second']['exact-id'].kind).toBe('uncertain')
    expect(useStore.getState().rehearsalApplications['/original']['exact-id'].kind).toBe(
      'uncertain'
    )
  } finally {
    useStore.setState({
      resync: originalResync,
      refreshAnalysis: originalRefresh,
      rehearsalApplications: {},
      rehearsalRecovery: {}
    })
  }
})

it('queries the original recovery worktree after a lost reply during a repository switch', async () => {
  let reject!: (error: Error) => void
  const rehearsalRecover = vi.fn().mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  const recovery = {
    state: 'unknown',
    repository: '/first',
    can_complete: false,
    can_rollback: false,
    message: 'blocked'
  }
  const rehearsalRecovery = vi.fn().mockResolvedValue(recovery)
  setBridge({ rehearsalRecover, rehearsalRecovery } as unknown as GitCityApi)
  useStore.setState({ repoPath: '/first', rehearsalRecovery: {} })
  const pending = useStore.getState().recoverRehearsal('exact-id', 'complete')
  useStore.setState({ repoPath: '/second' })
  reject(new Error('lost reply'))
  await pending
  expect(rehearsalRecovery).toHaveBeenCalledExactlyOnceWith('/first')
  expect(useStore.getState().rehearsalRecovery['/first']).toEqual(recovery)
  expect(useStore.getState().rehearsalRecovery['/second']).toBeUndefined()
})

it.each(['rebase', 'cherry-pick'] as const)(
  'passes the selected %s through the shared bridge without a direct fallback',
  async (action) => {
    const target = action === 'rebase' ? 'topic' : 'a'.repeat(40)
    const result: RehearsalResult = { kind: 'refused', message: 'Unsupported repository' }
    const rehearse = vi.fn().mockResolvedValue(result)
    const rebase = vi.fn()
    const cherryPick = vi.fn()
    setBridge({ rehearse, rebase, cherryPick } as unknown as GitCityApi)
    useStore.setState({ repoPath: '/original', rehearsalRequest: null })
    useStore.getState().openRehearsal({ action, target })
    expect(useStore.getState().rehearsalRequest).toEqual({ repo: '/original', action, target })
    await useStore.getState().rehearse(action, target)
    expect(rehearse).toHaveBeenCalledExactlyOnceWith('/original', action, target)
    expect(rebase).not.toHaveBeenCalled()
    expect(cherryPick).not.toHaveBeenCalled()
    expect(useStore.getState().rehearsalResults['/original']).toEqual(result)
  }
)

it('keeps Continue bound to its origin after a worktree switch and retains reports on refusal', async () => {
  const report: RehearsalReport = {
    schema: 1,
    command: ['rebase', '-i', '--root'],
    plan: {
      base: null,
      entries: [{ hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'first', action: 'pick' }]
    },
    checkout: { kind: 'branch', target: 'main' },
    pre_state: {},
    lifecycle: 'kept',
    outcome: 'stopped',
    conflicted: true,
    refs: [],
    conflicts: [{ path: 'file.txt', hunks: 1 }],
    drift: [],
    drift_unexpected: false,
    id: 'exact-id',
    repository: '/first',
    origin_worktree: '/first',
    repository_id: '/common'
  }
  let finish!: (result: RehearsalResult) => void
  const rehearsalContinue = vi.fn().mockImplementation(
    () =>
      new Promise<RehearsalResult>((resolve) => {
        finish = resolve
      })
  )
  setBridge({ rehearsalContinue } as unknown as GitCityApi)
  useStore.setState({
    repoPath: '/first',
    rehearsalResults: { '/first': { kind: 'report', report } }
  })
  const pending = useStore.getState().refreshRehearsal(report, true)
  await useStore.getState().refreshRehearsal(report, true)
  useStore.setState({ repoPath: '/second' })
  const next = { ...report, conflicted: false, conflicts: [], outcome: 'clean' as const }
  finish({ kind: 'report', report: { ...next, plan: undefined } })
  await pending
  expect(rehearsalContinue).toHaveBeenCalledExactlyOnceWith(report)
  expect(useStore.getState().rehearsalResults['/second']).toBeUndefined()
  expect(useStore.getState().rehearsalResults['/first']).toEqual({ kind: 'report', report: next })
  rehearsalContinue.mockResolvedValue({ kind: 'refused', message: 'Stopped state required' })
  await useStore.getState().refreshRehearsal(next, true)
  expect(useStore.getState().rehearsalResults['/first']).toEqual({ kind: 'report', report: next })
  const rehearsalConflictSave = vi.fn().mockResolvedValue(undefined)
  const rehearsalShow = vi.fn().mockResolvedValue({ kind: 'report', report: next })
  setBridge({ rehearsalConflictSave, rehearsalShow } as unknown as GitCityApi)
  expect(
    await useStore.getState().saveRehearsalConflict(report, 'file.txt', 'revision', 'reviewed')
  ).toMatchObject({ ok: true })
  expect(rehearsalConflictSave).toHaveBeenCalledExactlyOnceWith(
    report,
    'file.txt',
    'revision',
    'reviewed'
  )
  expect(rehearsalShow).toHaveBeenCalledExactlyOnceWith(report)
  expect(useStore.getState().rehearsalResults['/second']).toBeUndefined()
  rehearsalConflictSave.mockRejectedValue(new Error('File changed on disk'))
  expect(
    await useStore.getState().saveRehearsalConflict(report, 'file.txt', 'revision', 'stale')
  ).toEqual({ ok: false, message: 'File changed on disk' })
  expect(rehearsalShow).toHaveBeenCalledTimes(1)
})

it('inspects lost Undo responses once and refreshes views without retrying the mutation', async () => {
  const recovery = {
    state: 'none',
    repository: '/undo',
    can_complete: false,
    can_rollback: false,
    message: 'clear'
  }
  const rehearsalUndo = vi.fn().mockRejectedValue(new Error('index.lock response lost'))
  const rehearsalRecovery = vi.fn().mockResolvedValue(recovery)
  const resync = vi.fn().mockResolvedValue(undefined)
  const refreshAnalysis = vi.fn().mockResolvedValue(undefined)
  const loadRehearsals = vi.fn().mockResolvedValue(undefined)
  const saved = useStore.getState()
  setBridge({ rehearsalUndo, rehearsalRecovery } as unknown as GitCityApi)
  useStore.setState({ repoPath: '/undo', resync, refreshAnalysis, loadRehearsals })
  try {
    const identity = {
      repository: '/undo',
      worktree: '/undo',
      rehearsal: 'exact',
      applied_at_unix: 12,
      available: true,
      reason: null
    }
    const result = await useStore.getState().undoRehearsal(identity)
    expect(result?.kind).toBe('uncertain')
    expect(rehearsalUndo).toHaveBeenCalledExactlyOnceWith('/undo', identity)
    expect(rehearsalRecovery).toHaveBeenCalledExactlyOnceWith('/undo')
    expect(resync).toHaveBeenCalledOnce()
    expect(refreshAnalysis).toHaveBeenCalledOnce()
    expect(loadRehearsals).toHaveBeenCalledWith('/undo', true)
    expect(useStore.getState().rehearsalRecovery['/undo']).toEqual(recovery)
  } finally {
    useStore.setState({
      resync: saved.resync,
      refreshAnalysis: saved.refreshAnalysis,
      loadRehearsals: saved.loadRehearsals
    })
  }
})
