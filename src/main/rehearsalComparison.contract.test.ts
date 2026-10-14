import { beforeEach, expect, it, vi } from 'vitest'
import { compareRehearsal, resolveRehearsalEndpoints } from './rehearsalComparison'
import { rehearsalShow } from './rehearsal'
import { runGit } from './git/exec'
import { analyzeComparison } from './git/analyze'
import type { RehearsalReport } from '../shared/types'
import { rehearsalComparisonKey } from '../shared/rehearsalComparison'

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
  result_revision: `rr1:${'c'.repeat(40)}`,
  result_endpoints: {
    version: 1,
    origin: {
      rehearsal: 'selected',
      repository: '/origin',
      repository_id: 'repo',
      common_dir: '/origin/.git',
      git_dir: '/origin/.git'
    },
    action: ['merge', 'topic'],
    checkout: { kind: 'branch', target: 'main' },
    pre_state: { HEAD: before },
    results: { HEAD: after }
  },
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
  vi.mocked(runGit).mockImplementation(async (repo) => `${repo}/.git`)
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
it('clearly limits stopped carried city comparisons to the committed Before tree', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: {
      ...report,
      outcome: 'stopped',
      carried: { paths: ['file.txt'], status: 'conflicted', conflicts: ['file.txt'] },
      result_revision: undefined,
      result_endpoints: undefined,
      result_unavailable: 'The rehearsal stopped before producing authoritative endpoints.'
    }
  })

  const result = await compareRehearsal('/tool', report)

  expect(result.afterAvailable).toBe(false)
  expect(result.notice).toContain('Before shows only the frozen committed tree')
  expect(result.notice).toContain('tracked carried work is unavailable')
  expect(analyzeComparison).toHaveBeenCalledExactlyOnceWith('/sandbox', [before])
})
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
it('refuses carried review without authoritative endpoints instead of inferring old refs', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: { ...report, carried: { paths: ['file'], status: 'restored', conflicts: [] } }
  })
  vi.mocked(runGit).mockImplementation(async (_repo, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    return after
  })
  await expect(compareRehearsal('/tool', report)).rejects.toThrow('authoritative')
  expect(analyzeComparison).not.toHaveBeenCalled()
})

it('retains the carried snapshot ancestry guard for public endpoint descriptors', async () => {
  const snapshot = 'c'.repeat(40)
  const replay = 'd'.repeat(40)
  const withCarry: RehearsalReport = {
    ...report,
    carried: { paths: ['file'], status: 'restored', conflicts: [] },
    result_endpoints: {
      ...report.result_endpoints!,
      carried: {
        snapshot,
        snapshot_ref: snapshot,
        snapshot_ref_status: 'present',
        replay,
        replay_ref: replay,
        replay_ref_status: 'present',
        paths: ['file']
      }
    }
  }
  vi.mocked(runGit).mockImplementation(async (repo, args) => {
    if (args.includes('--path-format=absolute')) return `${repo}/.git`
    if (args.some((arg) => arg.includes(`${snapshot}^1`))) return 'f'.repeat(40)
    return after
  })
  await expect(resolveRehearsalEndpoints(withCarry)).rejects.toThrow(
    'carried-work snapshot does not match'
  )
})

it('invalidates the city key when the authoritative result endpoint changes under same carry status', () => {
  const carried = { paths: ['file'], status: 'restored', conflicts: [] }
  const first: RehearsalReport = {
    ...report,
    carried,
    result_revision: `rr1:${'c'.repeat(40)}`,
    result_endpoints: {
      version: 1,
      origin: {
        rehearsal: report.id,
        repository: report.repository,
        repository_id: report.repository_id,
        common_dir: '/origin/.git',
        git_dir: '/origin/.git'
      },
      action: report.command,
      checkout: report.checkout,
      pre_state: { HEAD: before },
      results: { HEAD: after },
      carried: {
        snapshot: 'c'.repeat(40),
        snapshot_ref: 'c'.repeat(40),
        snapshot_ref_status: 'present',
        replay: 'd'.repeat(40),
        replay_ref: 'd'.repeat(40),
        replay_ref_status: 'present',
        paths: ['file']
      }
    }
  }
  const second: RehearsalReport = {
    ...first,
    result_revision: `rr1:${'e'.repeat(40)}`,
    result_endpoints: {
      ...first.result_endpoints!,
      carried: {
        ...first.result_endpoints!.carried!,
        snapshot: 'e'.repeat(40),
        snapshot_ref: 'e'.repeat(40)
      }
    }
  }
  expect(second.carried?.status).toBe(first.carried?.status)
  expect(rehearsalComparisonKey(second)).not.toBe(rehearsalComparisonKey(first))
})
