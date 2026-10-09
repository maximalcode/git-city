import { beforeEach, expect, it, vi } from 'vitest'
import {
  rehearsalReviewFile,
  rehearsalReviewFiles,
  rehearsalReviewSummary
} from './rehearsalReview'
import { rehearsalShow } from './rehearsal'
import { runGit, runGitBuffer } from './git/exec'
import type { RehearsalReport } from '../shared/types'

vi.mock('fs/promises', () => ({ realpath: vi.fn(async (path: string) => path) }))
vi.mock('./rehearsal', () => ({ rehearsalShow: vi.fn() }))
vi.mock('./rehearsalComparison', () => ({
  resolveRehearsalEndpoints: vi.fn(async () => ['a'.repeat(40), 'b'.repeat(40)])
}))
vi.mock('./git/exec', () => ({ runGit: vi.fn(), runGitBuffer: vi.fn() }))

const before = 'a'.repeat(40)
const after = 'b'.repeat(40)
const oldObject = 'c'.repeat(40)
const newObject = 'd'.repeat(40)
const identity = {
  id: 'review-1',
  repository: '/origin',
  origin_worktree: '/origin',
  repository_id: 'repo'
}
const report: RehearsalReport = {
  schema: 1,
  ...identity,
  sandbox: '/sandbox',
  command: ['merge', 'topic'],
  checkout: { kind: 'branch', target: 'main' },
  pre_state: { HEAD: before },
  lifecycle: 'kept',
  outcome: 'clean',
  conflicted: false,
  conflicts: [],
  refs: [{ name: 'HEAD', before, after }],
  drift: [],
  drift_unexpected: false
}

const raw = `:100644 100644 ${oldObject} ${newObject} M\0:(pathspec) [x].txt\0`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rehearsalShow).mockResolvedValue({ kind: 'report', report })
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('diff-tree')) return raw
    if (args[1] === 'cat-file' && args[2] === '-s') return args[3] === oldObject ? '5' : '6'
    return ''
  })
  vi.mocked(runGitBuffer).mockImplementation(async (_root, args) => {
    const object = args.at(-1)
    return Buffer.from(object === oldObject ? 'old\n' : 'new!\n')
  })
})

it('returns a revision-bound complete scope and inventory without using a path selector', async () => {
  const summary = await rehearsalReviewSummary('/tool', identity)
  expect(summary.identity).toEqual(identity)
  expect(summary.afterAvailable).toBe(true)
  expect(summary.scopes[0]).toMatchObject({ scopeId: 'tracked-worktree', kind: 'tracked-worktree' })
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files.total).toBe(1)
  expect(files.entries[0]).toMatchObject({
    oldPath: ':(pathspec) [x].txt',
    newPath: ':(pathspec) [x].txt',
    change: 'modified',
    text: { changes: 'available' }
  })
  expect(files.entries[0].entryId).not.toBe(files.entries[0].newPath)
})

it('reads before, after and changes from immutable object IDs and rejects stale revisions', async () => {
  const summary = await rehearsalReviewSummary('/tool', identity)
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  const entry = files.entries[0]
  const beforeResult = await rehearsalReviewFile(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    entry.entryId,
    'before'
  )
  const afterResult = await rehearsalReviewFile(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    entry.entryId,
    'after'
  )
  const changes = await rehearsalReviewFile(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    entry.entryId,
    'changes'
  )
  expect(beforeResult.text).toBe('old\n')
  expect(afterResult.text).toBe('new!\n')
  expect(changes.hunks[0].lines.map((line) => line.kind)).toEqual(['del', 'add'])
  await expect(
    rehearsalReviewFiles('/tool', identity, 'stale', 'tracked-worktree')
  ).rejects.toThrow('changed')
  expect(vi.mocked(runGitBuffer).mock.calls.every(([, args]) => !args.includes('--filters'))).toBe(
    true
  )
  expect(
    vi
      .mocked(runGitBuffer)
      .mock.calls.every(([, args]) => args.at(-1) === oldObject || args.at(-1) === newObject)
  ).toBe(true)
  expect(
    vi.mocked(runGit).mock.calls.every(([, args]) => !args.includes(':(pathspec) [x].txt'))
  ).toBe(true)
  const diffCall = vi.mocked(runGit).mock.calls.find(([, args]) => args.includes('diff-tree'))
  expect(diffCall?.[1]).toEqual(
    expect.arrayContaining([
      '--no-replace-objects',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames'
    ])
  )
})

it('keeps missing and invalid retained objects explicit without reading a live file', async () => {
  vi.mocked(runGitBuffer).mockResolvedValue(null)
  const summary = await rehearsalReviewSummary('/tool', identity)
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files.entries[0].text).toMatchObject({
    before: 'unavailable',
    after: 'unavailable',
    changes: 'unavailable'
  })
  const missing = await rehearsalReviewFile(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    files.entries[0].entryId,
    'before'
  )
  expect(missing.availability).toBe('unavailable')
  expect(missing.text).toBeNull()

  vi.mocked(runGitBuffer).mockImplementation(async () => Buffer.from([0xff]))
  const invalid = await rehearsalReviewSummary('/tool', identity)
  const invalidFiles = await rehearsalReviewFiles(
    '/tool',
    identity,
    invalid.reviewRevision,
    'tracked-worktree'
  )
  expect(invalidFiles.entries[0].binary).toBe(true)
  expect(invalidFiles.entries[0].text.changes).toBe('binary')
})

it('leaves the incomplete inventory total unknown instead of claiming zero', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: { ...report, outcome: 'incomplete', conflicted: true }
  })
  const summary = await rehearsalReviewSummary('/tool', identity)
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files.complete).toBe(false)
  expect(files.entries).toEqual([])
  expect(files.total).toBeNull()
})
