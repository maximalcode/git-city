import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GitCityApi, RehearsalMode } from '../../shared/types'
import { setBridge } from './lib/bridge'
import { useStore } from './store'

const plan = {
  base: 'base',
  entries: [
    { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'change', action: 'pick' as const }
  ]
}
const actions = [
  { name: 'merge', run: () => useStore.getState().merge('topic'), args: ['/repo', 'topic'] },
  {
    name: 'rebase',
    run: () => useStore.getState().rebaseOnto('topic'),
    args: ['/repo', 'rebase', 'topic']
  },
  {
    name: 'cherryPick',
    run: () => useStore.getState().cherryPick('a'.repeat(40)),
    args: ['/repo', 'cherry-pick', 'a'.repeat(40)]
  },
  {
    name: 'rebaseInteractive',
    run: () => useStore.getState().runInteractiveRebase(plan.base, plan.entries),
    args: ['/repo', 'rebase', 'base', plan]
  }
]
beforeEach(() =>
  useStore.setState({
    repoPath: '/repo',
    rehearsalBusy: false,
    rehearsalRouting: false,
    opInProgress: null,
    rehearsalResults: {},
    rehearsalModeSetting: null,
    rehearsalModeError: null
  })
)
afterEach(() => setBridge(null))
function setup(mode: RehearsalMode | null) {
  const refusal = { kind: 'refused', message: 'Unsupported repository: shallow history' }
  const direct = vi.fn().mockResolvedValue({ ok: false, message: 'Direct action attempted' })
  const preview = vi.fn().mockResolvedValue(refusal)
  const getMode = vi.fn().mockResolvedValue({ repository: '/common', mode })
  const api = {
    rehearsalMode: getMode,
    rehearse: preview,
    rehearseMerge: preview,
    merge: direct,
    rebase: direct,
    cherryPick: direct,
    rebaseInteractive: direct,
    status: vi.fn(),
    branches: vi.fn(),
    stashList: vi.fn(),
    tags: vi.fn(),
    submodules: vi.fn(),
    worktrees: vi.fn()
  }
  setBridge(api as unknown as GitCityApi)
  return { direct, preview, getMode, refusal }
}
it.each(actions)(
  'routes $name to Automatic without fallback after refusal',
  async ({ run, args }) => {
    const { direct, preview, refusal } = setup('automatic')
    await run()
    expect(preview).toHaveBeenCalledExactlyOnceWith(...args)
    expect(direct).not.toHaveBeenCalled()
    expect(useStore.getState().rehearsalResults['/repo']).toEqual(refusal)
    expect(useStore.getState().rehearsalOpen).toBe(true)
  }
)
for (const mode of ['ask', 'off'] as const) {
  it.each(actions)(`${mode} preserves direct $name`, async ({ run }) => {
    const { direct, preview } = setup(mode)
    await run()
    expect(direct).toHaveBeenCalledTimes(1)
    expect(preview).not.toHaveBeenCalled()
  })
}
it.each(actions)('blocks $name until the existing user chooses', async ({ run }) => {
  const { direct, preview } = setup(null)
  await run()
  expect(direct).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(useStore.getState().rehearsalModeSetting?.mode).toBeNull()
})
it('rechecks the shared setting for each action, ignoring stale renderer state', async () => {
  const { direct, preview, getMode } = setup('automatic')
  useStore.setState({ rehearsalModeSetting: { repository: '/common', mode: 'off' } })
  await useStore.getState().merge('topic')
  getMode.mockResolvedValue({ repository: '/common', mode: 'off' })
  await useStore.getState().cherryPick('a'.repeat(40))
  expect(preview).toHaveBeenCalledTimes(1)
  expect(direct).toHaveBeenCalledTimes(1)
})
it('blocks actions on settings failure', async () => {
  const { direct, preview, getMode } = setup('automatic')
  getMode.mockRejectedValue(new Error('Settings need repair'))
  await useStore.getState().merge('topic')
  expect(direct).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
  expect(useStore.getState().rehearsalModeError).toContain('repair')
})
it('does not retarget an action while reading settings and suppresses duplicate starts', async () => {
  const { direct, preview, getMode } = setup('automatic')
  let resolve!: (value: unknown) => void
  getMode.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const pending = useStore.getState().merge('topic')
  await useStore.getState().merge('topic')
  useStore.setState({ repoPath: '/other' })
  resolve({ repository: '/common', mode: 'automatic' })
  await pending
  expect(getMode).toHaveBeenCalledTimes(1)
  expect(direct).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()
})
