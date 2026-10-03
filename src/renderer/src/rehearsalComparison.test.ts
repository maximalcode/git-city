import { hasRehearsalComparisonScene } from './rehearsalComparison'
import { rehearsalComparisonKey } from '../../shared/rehearsalComparison'
import { beforeEach, expect, it, vi } from 'vitest'
import { useStore } from './store'
import { setBridge } from './lib/bridge'
import type { GitCityApi, RehearsalComparison, RehearsalReport } from '../../shared/types'

const report: RehearsalReport = {
  schema: 1,
  id: 'first',
  repository: '/repo',
  origin_worktree: '/repo',
  repository_id: 'shared',
  command: ['merge', 'topic'],
  checkout: { kind: 'branch', target: 'main' },
  pre_state: {},
  lifecycle: 'kept',
  outcome: 'clean',
  conflicted: false,
  refs: [],
  conflicts: [],
  drift: [],
  drift_unexpected: false
}
const data: RehearsalComparison = {
  reportKey: rehearsalComparisonKey(report),
  identity: report,
  afterAvailable: true,
  notice: 'frozen',
  analysis: {
    info: { path: '/sandbox', name: 'test', branch: 'main', commitCount: 0 },
    paths: [],
    authors: [],
    snapshots: []
  }
}
beforeEach(() => {
  useStore.getState().clearRehearsalComparison()
  useStore.setState({
    repoPath: '/repo',
    rehearsalBusy: false,
    rehearsalResults: { '/repo': { kind: 'report', report } }
  })
})
it('rejects a response for another rehearsal', async () => {
  setBridge({
    rehearsalComparison: vi
      .fn()
      .mockResolvedValue({ ...data, identity: { ...report, id: 'other' } })
  } as unknown as GitCityApi)
  await useStore.getState().compareRehearsal(report)
  expect(useStore.getState().rehearsalComparison?.error).toContain('different rehearsal')
})
it('keeps the newer selected rehearsal when an earlier analysis finishes last', async () => {
  let finish!: (value: RehearsalComparison) => void
  const next = { ...report, id: 'second' }
  setBridge({
    rehearsalComparison: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue({ ...data, reportKey: rehearsalComparisonKey(next), identity: next })
  } as unknown as GitCityApi)
  const first = useStore.getState().compareRehearsal(report)
  useStore.setState({ rehearsalResults: { '/repo': { kind: 'report', report: next } } })
  await useStore.getState().compareRehearsal(next)
  finish(data)
  await first
  expect(useStore.getState().rehearsalComparison?.data?.identity.id).toBe('second')
})
it.each(['continue', 'worktree'])('invalidates a pending analysis on %s', async (change) => {
  let finish!: (value: RehearsalComparison) => void
  setBridge({
    rehearsalComparison: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  } as unknown as GitCityApi)
  const pending = useStore.getState().compareRehearsal(report)
  if (change === 'continue') useStore.getState().clearRehearsalComparison()
  else useStore.setState({ repoPath: '/another-worktree' })
  finish(data)
  await pending
  expect(useStore.getState().rehearsalComparison).toBeNull()
})

it('rejects an externally continued result until its report is refreshed', async () => {
  setBridge({
    rehearsalComparison: vi.fn().mockResolvedValue({ ...data, reportKey: 'newer-result' })
  } as unknown as GitCityApi)
  await useStore.getState().compareRehearsal(report)
  expect(useStore.getState().rehearsalComparison?.error).toContain('Refresh its report')
})

it('uses one comparison scene only while its exact report is visible', async () => {
  setBridge({ rehearsalComparison: vi.fn().mockResolvedValue(data) } as unknown as GitCityApi)
  useStore.setState({ rehearsalOpen: true, playing: true })
  await useStore.getState().compareRehearsal(report)
  expect(hasRehearsalComparisonScene(useStore.getState())).toBe(true)
  expect(useStore.getState().playing).toBe(false)
  useStore.setState({ rehearsalOpen: false })
  expect(hasRehearsalComparisonScene(useStore.getState())).toBe(false)
  useStore.setState({
    rehearsalOpen: true,
    rehearsalResults: { '/repo': { kind: 'report', report: { ...report, id: 'another' } } }
  })
  expect(hasRehearsalComparisonScene(useStore.getState())).toBe(false)
})
