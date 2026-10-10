import { rm } from 'fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTempRepo, type FixtureRepo } from './git/fixtures'
import {
  rehearsalReviewFile,
  rehearsalReviewFiles,
  rehearsalReviewSummary
} from './rehearsalReview'
import { rehearsalShow } from './rehearsal'
import { resolveRehearsalEndpoints } from './rehearsalComparison'
import type { RehearsalIdentity, RehearsalReport } from '../shared/types'

vi.mock('./rehearsal', () => ({ rehearsalShow: vi.fn() }))
vi.mock('./rehearsalComparison', () => ({ resolveRehearsalEndpoints: vi.fn() }))

const cleanups: string[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

type FixtureOptions = {
  modeOnly?: boolean
  renameTo?: string
  configIsolation?: boolean
}

type ReviewFixture = {
  identity: RehearsalIdentity
  sandbox: FixtureRepo
  origin: FixtureRepo
  path: string
}

function fixture(
  before: string | null,
  after: string | null,
  path: string,
  options: FixtureOptions = {}
): ReviewFixture {
  const origin = makeTempRepo('git-city-review-origin-')
  const sandbox = makeTempRepo('git-city-review-sandbox-')
  cleanups.push(origin.path, sandbox.path)
  origin.write('origin.txt', 'origin worktree\n')
  origin.commitAll('origin')
  if (before !== null) sandbox.write(path, before)
  if (before === null) sandbox.git('commit', '--allow-empty', '-m', 'before')
  else sandbox.commitAll('before')
  const beforeId = sandbox.git('rev-parse', 'HEAD').trim()
  let resultPath = path
  if (options.renameTo) {
    sandbox.git('mv', path, options.renameTo)
    resultPath = options.renameTo
  } else if (after === null) {
    sandbox.git('rm', '--', path)
  } else if (options.modeOnly) {
    sandbox.git('update-index', '--chmod=+x', '--', path)
  } else {
    sandbox.write(path, after)
  }
  if (options.configIsolation) {
    sandbox.write('.gitattributes', '*.txt binary\n')
    sandbox.git('config', 'color.ui', 'always')
  }
  // Keep the explicit index mode; re-staging with `git add -A` can erase it
  // on platforms whose worktree does not expose executable bits.
  if (options.modeOnly) sandbox.git('commit', '-m', 'after')
  else sandbox.commitAll('after')
  const afterId = sandbox.git('rev-parse', 'HEAD').trim()
  const identity = {
    id: `review-${path}`,
    repository: origin.path,
    repository_id: `repo-${path}`,
    origin_worktree: origin.path
  }
  const report: RehearsalReport = {
    schema: 1,
    ...identity,
    sandbox: sandbox.path,
    command: ['merge', 'topic'],
    checkout: { kind: 'branch', target: 'main' },
    pre_state: { HEAD: beforeId },
    lifecycle: 'kept',
    outcome: 'clean',
    conflicted: false,
    conflicts: [],
    refs: [{ name: 'HEAD', before: beforeId, after: afterId }],
    drift: [],
    drift_unexpected: false
  }
  vi.mocked(rehearsalShow).mockResolvedValue({ kind: 'report', report })
  vi.mocked(resolveRehearsalEndpoints).mockResolvedValue([beforeId, afterId])
  return { identity, sandbox, origin, path: resultPath }
}

async function reviewChanges(data: ReviewFixture) {
  const summary = await rehearsalReviewSummary('/tool', data.identity)
  const files = await rehearsalReviewFiles(
    '/tool',
    data.identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  const entry = files.entries.find(
    (candidate) => candidate.oldPath === data.path || candidate.newPath === data.path
  )
  expect(entry).toBeDefined()
  return {
    summary,
    files,
    result: await rehearsalReviewFile(
      '/tool',
      data.identity,
      summary.reviewRevision,
      'tracked-worktree',
      entry!.entryId,
      'changes'
    )
  }
}

describe('frozen review Git-backed API', () => {
  it('returns accurate same-line-count separated hunks and counts', async () => {
    const before = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join('\n')
    const after = before.replace('line 2', 'changed 2').replace('line 10', 'changed 10')
    const { files, result } = await reviewChanges(fixture(before, after, 'tracked.txt'))
    expect(files.entries[0].lines).toMatchObject({ additions: 2, deletions: 2 })
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].lines.map((line) => line.kind)).toEqual([
      'ctx',
      'del',
      'add',
      'ctx',
      'ctx',
      'ctx'
    ])
  })

  it('keeps identical-content renames as zero text changes', async () => {
    const { files, result } = await reviewChanges(
      fixture('same\n', 'same\n', 'old.txt', { renameTo: 'new.txt' })
    )
    expect(files.entries[0]).toMatchObject({ change: 'renamed', text: { changes: 'available' } })
    expect(files.entries[0].lines).toMatchObject({ additions: 0, deletions: 0 })
    expect(result.availability).toBe('available')
    expect(result.hunks).toEqual([])
  })

  it('shows explicit added, deleted and mode-only outcomes', async () => {
    const added = await reviewChanges(fixture(null, 'new\n', 'added.txt'))
    expect(added.result.hunks[0]).toMatchObject({
      header: '@@ -0,0 +1,1 @@',
      lines: [{ kind: 'add', text: 'new' }]
    })
    const deleted = await reviewChanges(fixture('old\n', null, 'deleted.txt'))
    expect(deleted.result.hunks[0]).toMatchObject({
      header: '@@ -1,1 +0,0 @@',
      lines: [{ kind: 'del', text: 'old' }]
    })
    const mode = await reviewChanges(fixture('same\n', 'same\n', 'mode.sh', { modeOnly: true }))
    expect(mode.result).toMatchObject({ availability: 'mode-only', hunks: [] })
  })

  it('ignores mutable attributes and color configuration for known text', async () => {
    const data = fixture('line\r\n', 'line', 'tracked.txt', { configIsolation: true })
    const sandboxStatus = data.sandbox.git('status', '--porcelain')
    const { result } = await reviewChanges(data)
    expect(result.availability).toBe('available')
    expect(result.hunks[0].lines).toEqual([
      { kind: 'del', text: 'line\r' },
      { kind: 'add', text: 'line' }
    ])
    expect(data.origin.git('status', '--porcelain')).toBe('')
    expect(data.sandbox.git('status', '--porcelain')).toBe(sandboxStatus)
  })
})
