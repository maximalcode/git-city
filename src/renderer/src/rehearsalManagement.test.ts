import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GitCityApi, RehearsalEntry, RehearsalInventory } from '../../shared/types'
import { setBridge } from './lib/bridge'
import { useStore } from './store'

const first: RehearsalEntry = {
  id: 'first',
  repository: '/repo',
  repository_id: 'shared',
  origin_worktree: '/repo',
  command: ['merge', 'topic'],
  checkout: { kind: 'branch', target: 'main' },
  pre_state: {},
  lifecycle: 'kept',
  execution: 'incomplete',
  active: false,
  stale: false,
  created_unix: 1,
  bytes: 100,
  freeBytes: 10000
}
const second = { ...first, id: 'second' }
const inventory = (entries: RehearsalEntry[]): RehearsalInventory => ({
  entries,
  repository: '/repo',
  bytes: 200,
  freeBytes: 10000,
  lowSpace: false,
  protected: false
})
const shown = (entry: RehearsalEntry) => ({
  kind: 'report' as const,
  report: {
    ...entry,
    schema: 1 as const,
    lifecycle: 'kept' as const,
    outcome: 'incomplete' as const,
    refs: [],
    conflicts: [],
    drift: [],
    conflicted: false,
    drift_unexpected: false
  }
})
function clear(): void {
  useStore.setState({
    repoPath: '/repo',
    rehearsalResults: {},
    rehearsalInventories: {},
    rehearsalCurrent: {},
    rehearsalManagementMessages: {},
    rehearsalBusy: false,
    rehearsalExecutionRepo: null,
    rehearsalStopping: false,
    rehearsalRequest: null
  })
}
beforeEach(() => {
  clear()
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value)
  })
})
afterEach(() => {
  clear()
  setBridge(null)
  vi.unstubAllGlobals()
})

it('restores the current identity from preferences after clearing session state, through the bridge', async () => {
  const rehearsalList = vi.fn().mockResolvedValue(inventory([first, second]))
  const rehearsalShow = vi.fn(async (entry: RehearsalEntry) => shown(entry))
  setBridge({ rehearsalList, rehearsalShow } as unknown as GitCityApi)
  await useStore.getState().selectRehearsal('/repo', second)
  clear()
  await useStore.getState().loadRehearsals('/repo')
  expect(useStore.getState().rehearsalResults['/repo']).toEqual(shown(second))
  expect(rehearsalShow).toHaveBeenLastCalledWith(second)
})

it('keeps partial discard failures visible and reloads non-selected retained data', async () => {
  const rehearsalDiscard = vi.fn().mockResolvedValue({
    discarded: ['first'],
    failures: [{ id: 'missing', message: 'identity mismatch' }]
  })
  const rehearsalList = vi.fn().mockResolvedValue(inventory([second]))
  setBridge({
    rehearsalDiscard,
    rehearsalList,
    rehearsalShow: vi.fn().mockResolvedValue(shown(second))
  } as unknown as GitCityApi)
  await useStore.getState().discardRehearsals('/repo', [first, { ...first, id: 'missing' }])
  expect(rehearsalDiscard).toHaveBeenCalledExactlyOnceWith('/repo', [
    first,
    { ...first, id: 'missing' }
  ])
  expect(useStore.getState().rehearsalInventories['/repo'].entries).toEqual([second])
  expect(useStore.getState().rehearsalManagementMessages['/repo']).toContain(
    'missing: identity mismatch'
  )
})

it('routes late inventory to its original worktree and never attempts to show an active result', async () => {
  let finish!: (value: RehearsalInventory) => void
  const rehearsalList = vi.fn(
    () =>
      new Promise<RehearsalInventory>((resolve) => {
        finish = resolve
      })
  )
  const rehearsalShow = vi.fn()
  setBridge({ rehearsalList, rehearsalShow } as unknown as GitCityApi)
  const pending = useStore.getState().loadRehearsals('/repo')
  useStore.setState({ repoPath: '/other' })
  finish(inventory([{ ...first, active: true }]))
  await pending
  expect(rehearsalShow).not.toHaveBeenCalled()
  expect(useStore.getState().rehearsalInventories['/other']).toBeUndefined()
  expect(useStore.getState().rehearsalResults['/repo'].kind).toBe('error')
})

it('Stop never calls Apply or recovery and cannot target a non-execution busy operation', async () => {
  const rehearsalStop = vi.fn().mockResolvedValue({ ok: true, message: 'Execution ended' })
  const rehearsalApply = vi.fn()
  const rehearsalRecover = vi.fn()
  const rehearsalList = vi.fn().mockResolvedValue(inventory([first]))
  setBridge({
    rehearsalStop,
    rehearsalApply,
    rehearsalRecover,
    rehearsalList
  } as unknown as GitCityApi)
  useStore.setState({ rehearsalBusy: true })
  await useStore.getState().stopRehearsal()
  expect(rehearsalStop).not.toHaveBeenCalled()
  useStore.setState({ rehearsalExecutionRepo: '/repo', repoPath: '/other' })
  await useStore.getState().stopRehearsal()
  expect(rehearsalStop).toHaveBeenCalledExactlyOnceWith('/repo')
  expect(rehearsalList).toHaveBeenCalledExactlyOnceWith('/repo')
  expect(rehearsalApply).not.toHaveBeenCalled()
  expect(rehearsalRecover).not.toHaveBeenCalled()
})
