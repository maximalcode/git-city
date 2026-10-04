import { beforeEach, expect, it, vi } from 'vitest'
import { compareRehearsal } from './rehearsalComparison'
import { rehearsalShow } from './rehearsal'
import { runGit } from './git/exec'
import { analyzeComparison } from './git/analyze'
import type { RehearsalReport } from '../shared/types'

vi.mock('fs/promises', () => ({ realpath: vi.fn(async (path) => path) }))
vi.mock('./rehearsal', () => ({ rehearsalShow: vi.fn() }))
vi.mock('./git/exec', () => ({ runGit: vi.fn() }))
vi.mock('./git/analyze', () => ({ analyzeComparison: vi.fn(async () => ({ snapshots: [] })) }))
const before = 'a'.repeat(40)
const after = 'b'.repeat(40)
const report: RehearsalReport = {
  schema: 1,
  id: 'selected',
  repository: '/origin',
  origin_worktree: '/origin',
  repository_id: 'repo',
  sandbox: '/sandbox',
  command: ['merge', 'topic'],
  checkout: { kind: 'branch', target: 'main' },
  pre_state: { HEAD: before },
  refs: [{ name: 'HEAD', before, after }],
  lifecycle: 'kept',
  outcome: 'clean',
  conflicted: false,
  conflicts: [],
  drift: [],
  drift_unexpected: false
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rehearsalShow).mockResolvedValue({ kind: 'report', report })
  vi.mocked(runGit).mockResolvedValue('/sandbox/.git')
})
it.each(['stopped', 'failed', 'incomplete'] as const)(
  'never labels %s as finished After',
  async (outcome) => {
    vi.mocked(rehearsalShow).mockResolvedValue({ kind: 'report', report: { ...report, outcome } })
    const result = await compareRehearsal('/tool', report)
    expect(result.afterAvailable).toBe(false)
    expect(result.notice).toContain('No finished After')
    expect(analyzeComparison).toHaveBeenCalledExactlyOnceWith('/sandbox', [before])
  }
)
it('refuses an active or missing rehearsal without analyzing anything', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({ kind: 'refused', message: 'Rehearsal is active' })
  await expect(compareRehearsal('/tool', report)).rejects.toThrow('active')
  expect(analyzeComparison).not.toHaveBeenCalled()
})
it('discards analysis when the report changes during the read', async () => {
  vi.mocked(rehearsalShow)
    .mockResolvedValueOnce({ kind: 'report', report })
    .mockResolvedValueOnce({ kind: 'report', report: { ...report, outcome: 'incomplete' } })
  await expect(compareRehearsal('/tool', report)).rejects.toThrow('changed during analysis')
})
it('refuses missing frozen HEAD instead of falling back to real HEAD', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: { ...report, pre_state: {} }
  })
  await expect(compareRehearsal('/tool', report)).rejects.toThrow('Frozen comparison commit')
  expect(analyzeComparison).not.toHaveBeenCalled()
})
it.each(['/origin', '/origin/nested'])('refuses non-isolated sandbox %s', async (sandbox) => {
  vi.mocked(rehearsalShow).mockResolvedValue({ kind: 'report', report: { ...report, sandbox } })
  await expect(compareRehearsal('/tool', report)).rejects.toThrow('separate retained sandbox')
  expect(analyzeComparison).not.toHaveBeenCalled()
})
it('rejects incompatible retained carry objects instead of omitting local work', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: { ...report, carried: { paths: ['file'], status: 'restored', conflicts: [] } }
  })
  vi.mocked(runGit).mockImplementation(async (_repo, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    return after
  })
  await expect(compareRehearsal('/tool', report)).rejects.toThrow('snapshot does not match')
  expect(analyzeComparison).not.toHaveBeenCalled()
})
