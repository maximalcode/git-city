import { rm } from 'fs/promises'
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTempRepo, type FixtureRepo } from './git/fixtures'
import {
  REHEARSAL_REVIEW_BLOB_LIMIT,
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

type FileValue = string | Uint8Array | { symlink: string }

type ReviewFixture = {
  identity: RehearsalIdentity
  sandbox: FixtureRepo
  origin: FixtureRepo
  path: string
}

function fixture(
  before: FileValue | null,
  after: FileValue | null,
  path: string,
  options: FixtureOptions = {}
): ReviewFixture {
  const origin = makeTempRepo('git-city-review-origin-')
  const sandbox = makeTempRepo('git-city-review-sandbox-')
  cleanups.push(origin.path, sandbox.path)
  origin.write('origin.txt', 'origin worktree\n')
  origin.commitAll('origin')
  if (before !== null) stageValue(sandbox, path, before)
  if (before === null) sandbox.git('commit', '--allow-empty', '-m', 'before')
  else if (isSymlinkValue(before)) sandbox.git('commit', '-m', 'before')
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
    stageValue(sandbox, path, after)
  }
  if (options.configIsolation) {
    sandbox.write('.gitattributes', '*.txt binary\n')
    sandbox.git('config', 'color.ui', 'always')
  }
  // Keep the explicit index mode; re-staging with `git add -A` can erase it
  // on platforms whose worktree does not expose executable bits.
  if (options.modeOnly || isSymlinkValue(after)) sandbox.git('commit', '-m', 'after')
  else sandbox.commitAll('after')
  const afterId = sandbox.git('rev-parse', 'HEAD').trim()
  return mockFixture(origin, sandbox, resultPath, beforeId, afterId)
}

function writeValue(repo: FixtureRepo, rel: string, value: FileValue): void {
  const absolute = join(repo.path, rel)
  mkdirSync(dirname(absolute), { recursive: true })
  // The fixture deliberately removes the old inode before writing so a
  // symlink cannot accidentally turn a later write into a target write.
  try {
    unlinkSync(absolute)
  } catch {
    // The path is absent for added files.
  }
  if (typeof value === 'string') writeFileSync(absolute, value)
  else if (value instanceof Uint8Array) writeFileSync(absolute, value)
  else throw new Error('Symlinks must be staged through Git index plumbing.')
}

function isSymlinkValue(value: FileValue | null): value is { symlink: string } {
  return value !== null && typeof value === 'object' && !(value instanceof Uint8Array)
}

function stageValue(repo: FixtureRepo, rel: string, value: FileValue): void {
  if (!isSymlinkValue(value)) {
    writeValue(repo, rel, value)
    return
  }
  // Keep this fixture portable on hosts where creating filesystem symlinks is
  // disabled. The committed object still has Git's real 120000 mode.
  writeValue(repo, rel, value.symlink)
  const objectId = repo.git('hash-object', '-w', '--', rel).trim()
  repo.git('update-index', '--add', '--cacheinfo', `120000,${objectId},${rel}`)
}

function mockFixture(
  origin: FixtureRepo,
  sandbox: FixtureRepo,
  path: string,
  beforeId: string,
  afterId: string
): ReviewFixture {
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
  return { identity, sandbox, origin, path }
}

function gitlinkFixture(): ReviewFixture {
  const origin = makeTempRepo('git-city-review-origin-')
  const sandbox = makeTempRepo('git-city-review-sandbox-')
  const nested = makeTempRepo('git-city-review-gitlink-')
  cleanups.push(origin.path, sandbox.path, nested.path)
  origin.write('origin.txt', 'origin worktree\n')
  origin.commitAll('origin')

  nested.write('payload.txt', 'first nested commit\n')
  nested.commitAll('nested-before')
  const beforeNestedId = nested.git('rev-parse', 'HEAD').trim()
  sandbox.git('update-index', '--add', '--cacheinfo', `160000,${beforeNestedId},submodule`)
  sandbox.git('commit', '-m', 'before')
  const beforeId = sandbox.git('rev-parse', 'HEAD').trim()

  nested.write('payload.txt', 'second nested commit\n')
  nested.commitAll('nested-after')
  const afterNestedId = nested.git('rev-parse', 'HEAD').trim()
  sandbox.git('update-index', '--add', '--cacheinfo', `160000,${afterNestedId},submodule`)
  sandbox.git('commit', '-m', 'after')
  const afterId = sandbox.git('rev-parse', 'HEAD').trim()
  return mockFixture(origin, sandbox, 'submodule', beforeId, afterId)
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

  it('classifies binary, symlink, gitlink, and oversized objects from real Git trees', async () => {
    const binary = await reviewChanges(
      fixture(Buffer.from([0, 1, 2, 3]), Buffer.from([0, 1, 2, 4]), 'asset.bin')
    )
    expect(binary.result).toMatchObject({ availability: 'binary', hunks: [] })
    expect(binary.result.entry).toMatchObject({
      type: 'binary',
      binary: true,
      text: { changes: 'binary', before: 'binary', after: 'binary' }
    })

    const symlink = await reviewChanges(
      fixture({ symlink: 'old-target' }, { symlink: 'new-target' }, 'link')
    )
    expect(symlink.result).toMatchObject({ availability: 'available' })
    expect(symlink.result.entry).toMatchObject({
      type: 'symlink',
      old: { mode: '120000' },
      new: { mode: '120000' }
    })
    expect(symlink.result.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text))).toEqual([
      'old-target',
      'new-target'
    ])

    const gitlink = await reviewChanges(gitlinkFixture())
    expect(gitlink.result).toMatchObject({ availability: 'available' })
    expect(gitlink.result.entry).toMatchObject({
      type: 'gitlink',
      old: { mode: '160000', present: true },
      new: { mode: '160000', present: true },
      text: { changes: 'available' }
    })
    expect(gitlink.result.hunks[0].lines).toEqual([
      { kind: 'del', text: expect.stringMatching(/^[0-9a-f]{40}$/) },
      { kind: 'add', text: expect.stringMatching(/^[0-9a-f]{40}$/) }
    ])

    const oversized = await reviewChanges(
      fixture(
        Buffer.alloc(REHEARSAL_REVIEW_BLOB_LIMIT + 1, 0x61),
        Buffer.concat([
          Buffer.alloc(REHEARSAL_REVIEW_BLOB_LIMIT, 0x61),
          Buffer.from('b')
        ]),
        'large.txt'
      )
    )
    expect(oversized.result).toMatchObject({ availability: 'too-large', hunks: [] })
    expect(oversized.result.entry).toMatchObject({
      type: 'text',
      text: { changes: 'too-large', before: 'too-large', after: 'too-large' },
      lines: { before: null, after: null, additions: null, deletions: null }
    })
  })

  it('keeps external diff and textconv disabled for unusual literal paths', async () => {
    const path = '-literal path [x]$.txt'
    const data = fixture('before\n', 'after\n', path)
    const marker = join(data.sandbox.path, '.hostile-diff-invoked')
    const script = join(data.sandbox.path, '.hostile-diff.sh')
    writeFileSync(
      script,
      `#!/bin/sh\nprintf invoked > '${marker.replaceAll("'", "'\\''")}'\nexit 99\n`
    )
    chmodSync(script, 0o755)
    data.sandbox.write('.gitattributes', '*.txt diff=sentinel\n')
    data.sandbox.git('config', 'diff.external', script)
    data.sandbox.git('config', 'diff.sentinel.textconv', script)
    const status = data.sandbox.git('status', '--porcelain')
    const { result } = await reviewChanges(data)
    expect(result).toMatchObject({ availability: 'available' })
    expect(result.entry).toMatchObject({ oldPath: path, newPath: path, type: 'text' })
    expect(result.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text))).toEqual([
      'before',
      'after'
    ])
    expect(() => readFileSync(marker)).toThrow()
    expect(data.sandbox.git('status', '--porcelain')).toBe(status)
    expect(data.origin.git('status', '--porcelain')).toBe('')
  })

  it('refuses a missing frozen endpoint without falling back to the live tree', async () => {
    const data = fixture('before\n', 'after\n', 'tracked.txt')
    const afterId = data.sandbox.git('rev-parse', 'HEAD').trim()
    const objectPath = join(
      data.sandbox.path,
      '.git',
      'objects',
      afterId.slice(0, 2),
      afterId.slice(2)
    )
    expect(() => readFileSync(objectPath)).not.toThrow()
    const originStatus = data.origin.git('status', '--porcelain')
    unlinkSync(objectPath)

    const summary = await rehearsalReviewSummary('/tool', data.identity)
    expect(summary.complete).toBe(false)
    expect(summary.afterAvailable).toBe(false)
    expect(summary.scopes[0]).toMatchObject({ available: false })
    expect(summary.changeMap['tracked-worktree']).toEqual([])
    const files = await rehearsalReviewFiles(
      '/tool',
      data.identity,
      summary.reviewRevision,
      'tracked-worktree'
    )
    expect(files).toMatchObject({ entries: [], total: null, complete: false })
    expect(data.origin.git('status', '--porcelain')).toBe(originStatus)
    expect(readFileSync(join(data.sandbox.path, 'tracked.txt'), 'utf8')).toBe('after\n')
  })
})
