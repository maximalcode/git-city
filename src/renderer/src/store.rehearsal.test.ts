import { afterEach, expect, it, vi } from 'vitest'
import type { GitCityApi, RehearsalResult } from '../../shared/types'
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
  await useStore.getState().rehearseMerge('topic')
  useStore.setState({ repoPath: '/second' })
  finish({ kind: 'error', message: 'Execution interrupted' })
  await pending
  expect(rehearseMerge).toHaveBeenCalledTimes(1)
  expect(useStore.getState().rehearsalResults['/second']).toBeUndefined()
  expect(useStore.getState().rehearsalResults['/first'].kind).toBe('error')
  expect(useStore.getState().rehearsalBusy).toBe(false)
})
