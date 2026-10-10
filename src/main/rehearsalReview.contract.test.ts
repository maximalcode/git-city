import { beforeEach, expect, it, vi } from 'vitest'
import {
  rehearsalReviewFile,
  rehearsalReviewFiles,
  rehearsalReviewSummary
} from './rehearsalReview'
import { rehearsalShow } from './rehearsal'
import { runGit, runGitBuffer, runGitBufferBounded, runGitResult } from './git/exec'
import type { RehearsalReport } from '../shared/types'

vi.mock('fs/promises', () => ({ realpath: vi.fn(async (path: string) => path) }))
vi.mock('./rehearsal', () => ({ rehearsalShow: vi.fn() }))
vi.mock('./rehearsalComparison', () => ({
  resolveRehearsalEndpoints: vi.fn(async () => ['a'.repeat(40), 'b'.repeat(40)])
}))
vi.mock('./git/exec', () => ({
  runGit: vi.fn(),
  runGitBuffer: vi.fn(),
  runGitBufferBounded: vi.fn(),
  runGitResult: vi.fn(async () => ({
    code: 0,
    stdout: '4b825dc642cb6eb9a060e54bf8d69288fbee4904\n',
    stderr: ''
  }))
}))

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
  vi.mocked(runGitBufferBounded).mockImplementation(async (_root, args) => ({
    kind: 'ok',
    bytes: Buffer.from(args.includes('diff-tree') ? raw : '@@ -1 +1 @@\n-old\n+new!\n')
  }))
})

it('returns a revision-bound complete scope and inventory without using a path selector', async () => {
  const summary = await rehearsalReviewSummary('/tool', identity)
  expect(runGitBuffer).not.toHaveBeenCalled()
  expect(summary.identity).toEqual(identity)
  expect(summary.afterAvailable).toBe(true)
  expect(summary.scopes[0]).toMatchObject({ scopeId: 'tracked-worktree', kind: 'tracked-worktree' })
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(runGitBuffer).toHaveBeenCalledTimes(2)
  expect(files.total).toBe(1)
  expect(files.entries[0]).toMatchObject({
    oldPath: ':(pathspec) [x].txt',
    newPath: ':(pathspec) [x].txt',
    change: 'modified',
    text: { changes: 'available' }
  })
  expect(files.entries[0].entryId).not.toBe(files.entries[0].newPath)
})

it('publishes a complete blob-free change map and resolves an entry beyond the first page', async () => {
  const manyRaw = Array.from(
    { length: 201 },
    (_, index) => `:100644 100644 ${oldObject} ${newObject} M\0src/file-${index}.ts\0`
  ).join('')
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('diff-tree')) return manyRaw
    if (args[1] === 'cat-file' && args[2] === '-s') return '5'
    return ''
  })
  vi.mocked(runGitBufferBounded).mockImplementation(async (_root, args) => ({
    kind: 'ok',
    bytes: Buffer.from(args.includes('diff-tree') ? manyRaw : '@@ -1 +1 @@\n-old\n+new\n')
  }))

  const summary = await rehearsalReviewSummary('/tool', identity)
  const map = summary.changeMap['tracked-worktree']
  expect(map).toHaveLength(201)
  expect(vi.mocked(runGitBuffer)).not.toHaveBeenCalled()

  const last = map[200]
  const result = await rehearsalReviewFile(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    last.entryId,
    'changes'
  )
  expect(result.entry.entryId).toBe(last.entryId)
  expect(result.entry.newPath).toBe('src/file-200.ts')
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
  const blobDiffCall = vi
    .mocked(runGitBufferBounded)
    .mock.calls.find(([, args]) => args.includes('diff'))
  expect(blobDiffCall?.[1]).toEqual(
    expect.arrayContaining([
      '--no-replace-objects',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      oldObject,
      newObject
    ])
  )
  const diffCall = vi
    .mocked(runGitBufferBounded)
    .mock.calls.find(([, args]) => args.includes('diff-tree'))
  expect(diffCall?.[1]).toEqual(
    expect.arrayContaining([
      '--no-replace-objects',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames'
    ])
  )
})

it('rejects a retained result that changes after page analysis', async () => {
  const summary = await rehearsalReviewSummary('/tool', identity)
  let reads = 0
  vi.mocked(rehearsalShow).mockImplementation(async () => {
    reads++
    return { kind: 'report', report: reads === 3 ? { ...report, outcome: 'incomplete' } : report }
  })
  await expect(
    rehearsalReviewFiles('/tool', identity, summary.reviewRevision, 'tracked-worktree')
  ).rejects.toThrow('changed during review')
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
  expect(summary.changeMap['tracked-worktree']).toEqual([])
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

it('returns distinct committed-reference scopes with grouped aliases and explicit empty sides', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: {
      ...report,
      refs: [
        { name: 'HEAD', before, after },
        { name: 'refs/heads/main', before, after },
        { name: 'refs/heads/alias', before, after },
        { name: 'refs/heads/deleted', before, after: undefined },
        { name: 'refs/heads/created', before: undefined, after }
      ],
      drift: [
        {
          reference: 'refs/heads/main',
          files: [],
          commits_before: 1,
          commits_after: 1,
          replay: { changed: ['old'], dropped: [], added: ['new'], compared: false }
        }
      ]
    }
  })
  const summary = await rehearsalReviewSummary('/tool', identity)
  const committed = summary.scopes.filter((scope) => scope.kind === 'committed-reference')
  expect(committed).toHaveLength(4)
  expect(
    committed.find((scope) => scope.refAliases.includes('refs/heads/main'))?.refAliases
  ).toEqual(['HEAD', 'refs/heads/main'])
  expect(
    committed.find((scope) => scope.refAliases.includes('refs/heads/alias'))?.refAliases
  ).toEqual(['refs/heads/alias'])
  const deleted = committed.find((scope) => scope.refAliases.includes('refs/heads/deleted'))!
  const created = committed.find((scope) => scope.refAliases.includes('refs/heads/created'))!
  expect(deleted.after).toMatchObject({ kind: 'empty', commit: null })
  expect(created.before).toMatchObject({ kind: 'empty', commit: null })
  expect(
    committed.find((scope) => scope.refAliases.includes('refs/heads/main'))?.replay
  ).toMatchObject({
    changed: ['old'],
    added: ['new'],
    compared: false
  })
  expect(summary.replayWarnings).toHaveLength(1)
})

it('preserves special file metadata and detected rename identity', async () => {
  const symlinkObject = 'e'.repeat(40)
  const gitlinkOld = 'f'.repeat(40)
  const gitlinkNew = '1'.repeat(40)
  const modeObject = '2'.repeat(40)
  const renamedOld = '3'.repeat(40)
  const renamedNew = '4'.repeat(40)
  const specialRaw = [
    `:000000 120000 ${'0'.repeat(40)} ${symlinkObject} A\0link\0`,
    `:160000 160000 ${gitlinkOld} ${gitlinkNew} M\0submodule\0`,
    `:100644 100755 ${modeObject} ${modeObject} M\0script.sh\0`,
    `:100644 100644 ${renamedOld} ${renamedNew} R100\0old.txt\0new.txt\0`
  ].join('')
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('diff-tree')) return specialRaw
    if (args[1] === 'cat-file' && args[2] === '-s') return '5'
    return ''
  })
  vi.mocked(runGitBufferBounded).mockImplementation(async (_root, args) => ({
    kind: 'ok',
    bytes: Buffer.from(args.includes('diff-tree') ? specialRaw : '@@ -1 +1 @@\n-text\n+text\n')
  }))
  vi.mocked(runGitBuffer).mockImplementation(async (_root, args) => {
    const object = args.at(-1)
    return Buffer.from(object === symlinkObject ? '../target' : 'text\n')
  })
  const summary = await rehearsalReviewSummary('/tool', identity)
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files.entries).toHaveLength(4)
  expect(files.entries.find((entry) => entry.type === 'symlink')).toMatchObject({
    old: { present: false },
    new: { mode: '120000' },
    text: { after: 'available' }
  })
  expect(files.entries.find((entry) => entry.type === 'gitlink')).toMatchObject({
    change: 'modified',
    text: { before: 'available', after: 'available' }
  })
  expect(files.entries.find((entry) => entry.newPath === 'script.sh')).toMatchObject({
    type: 'mode',
    text: { changes: 'mode-only' }
  })
  expect(files.entries.find((entry) => entry.change === 'renamed')).toMatchObject({
    oldPath: 'old.txt',
    newPath: 'new.txt',
    rename: 'detected'
  })
})

it('pages the complete inventory at 200 and marks bounded rename detection', async () => {
  const manyRaw = Array.from({ length: 401 }, (_, index) => {
    const object = index.toString(16).padStart(40, '0')
    return `:000000 100644 ${'0'.repeat(40)} ${object} A\0file-${index}.txt\0`
  }).join('')
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('diff-tree')) return manyRaw
    if (args[1] === 'cat-file' && args[2] === '-s') return '5'
    return ''
  })
  vi.mocked(runGitBufferBounded).mockImplementation(async (_root, args) => ({
    kind: 'ok',
    bytes: Buffer.from(args.includes('diff-tree') ? manyRaw : '@@ -1 +1 @@\n-text\n+text\n')
  }))
  vi.mocked(runGitBuffer).mockResolvedValue(Buffer.from('text\n'))
  const summary = await rehearsalReviewSummary('/tool', identity)
  expect(summary.notices).toContain(
    'Rename detection was bounded for a large change set; complete add/delete entries remain visible.'
  )
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files.total).toBe(401)
  expect(files.entries).toHaveLength(200)
  expect(files.nextCursor).toBeTruthy()
  expect(files.entries[0].rename).toBe('limited')
  expect(vi.mocked(runGitBuffer).mock.calls).toHaveLength(199)

  const filtered = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    undefined,
    'file-400'
  )
  expect(filtered.total).toBe(1)
  expect(filtered.entries).toHaveLength(1)
  expect(filtered.entries[0].newPath).toBe('file-400.txt')

  vi.mocked(runGitBuffer).mockClear()
  await rehearsalReviewFile(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree',
    files.entries[1].entryId,
    'before'
  )
  expect(
    vi
      .mocked(runGitBuffer)
      .mock.calls.every(([, args]) => args.at(-1) === files.entries[1].new.objectId)
  ).toBe(true)
})

it('keeps over-limit blobs and generated patches explicit', async () => {
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('diff-tree')) return raw
    if (args[1] === 'cat-file' && args[2] === '-s') return String(2 * 1024 * 1024 + 1)
    return ''
  })
  vi.mocked(runGitBufferBounded).mockResolvedValue({ kind: 'ok', bytes: Buffer.from(raw) })
  const summary = await rehearsalReviewSummary('/tool', identity)
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files.entries[0].text).toMatchObject({
    before: 'too-large',
    after: 'too-large',
    changes: 'too-large'
  })

  const oldText = `${'a'.repeat(2 * 1024 * 1024)}\n`
  const newText = `${'b'.repeat(2 * 1024 * 1024)}\n`
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('diff-tree')) return raw
    if (args[1] === 'cat-file' && args[2] === '-s') return String(2 * 1024 * 1024)
    return ''
  })
  vi.mocked(runGitBuffer).mockImplementation(async (_root, args) =>
    Buffer.from(args.at(-1) === oldObject ? oldText : newText)
  )
  vi.mocked(runGitBufferBounded).mockImplementation(async (_root, args) =>
    args.includes('diff-tree') ? { kind: 'ok', bytes: Buffer.from(raw) } : { kind: 'too-large' }
  )
  const large = await rehearsalReviewSummary('/tool', identity)
  const largeFiles = await rehearsalReviewFiles(
    '/tool',
    identity,
    large.reviewRevision,
    'tracked-worktree'
  )
  expect(largeFiles.entries[0].text.changes).toBe('too-large')
  const largeChanges = await rehearsalReviewFile(
    '/tool',
    identity,
    large.reviewRevision,
    'tracked-worktree',
    largeFiles.entries[0].entryId,
    'changes'
  )
  expect(largeChanges.availability).toBe('too-large')
  expect(largeChanges.hunks).toEqual([])
})

it('refuses an oversized retained inventory explicitly', async () => {
  vi.mocked(runGitBufferBounded).mockImplementation(async (_root, args) =>
    args.includes('diff-tree') ? { kind: 'too-large' } : { kind: 'unavailable' }
  )
  await expect(rehearsalReviewSummary('/tool', identity)).rejects.toThrow('32 MiB')
})

it('preserves a committed scope when one retained endpoint object is missing', async () => {
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: {
      ...report,
      refs: [
        { name: 'HEAD', before, after },
        { name: 'refs/heads/missing', before, after }
      ]
    }
  })
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('cat-file') && args.includes('-e')) throw new Error('missing object')
    if (args.includes('diff-tree')) return raw
    if (args[1] === 'cat-file' && args[2] === '-s') return '5'
    return ''
  })
  const summary = await rehearsalReviewSummary('/tool', identity)
  const scope = summary.scopes.find((item) => item.refAliases.includes('refs/heads/missing'))!
  expect(scope.available).toBe(false)
  expect(scope.unavailableReason).toContain('not replaced')
  const files = await rehearsalReviewFiles('/tool', identity, summary.reviewRevision, scope.scopeId)
  expect(files.complete).toBe(false)
  expect(files.total).toBeNull()
  expect(files.entries).toEqual([])
})

it('does not replace a missing tracked endpoint with live worktree content', async () => {
  vi.mocked(runGit).mockImplementation(async (_root, args) => {
    if (args.includes('--path-format=absolute')) return '/sandbox/.git'
    if (args.includes('cat-file') && args.includes('-e')) throw new Error('missing object')
    return ''
  })
  const summary = await rehearsalReviewSummary('/tool', identity)
  expect(summary.complete).toBe(false)
  expect(summary.afterAvailable).toBe(false)
  expect(summary.scopes[0]).toMatchObject({
    scopeId: 'tracked-worktree',
    available: false,
    unavailableReason: expect.stringContaining('not replaced')
  })
  const files = await rehearsalReviewFiles(
    '/tool',
    identity,
    summary.reviewRevision,
    'tracked-worktree'
  )
  expect(files).toMatchObject({ complete: false, total: null, entries: [] })
})

it('derives the empty tree in the repository object format', async () => {
  const emptyTreeSha256 = 'e'.repeat(64)
  vi.mocked(runGitResult).mockResolvedValue({
    code: 0,
    stdout: `${emptyTreeSha256}\n`,
    stderr: ''
  })
  vi.mocked(runGitBufferBounded).mockResolvedValue({ kind: 'ok', bytes: Buffer.from(raw) })
  vi.mocked(rehearsalShow).mockResolvedValue({
    kind: 'report',
    report: {
      ...report,
      refs: [
        { name: 'HEAD', before, after },
        { name: 'refs/heads/deleted', before, after: undefined }
      ]
    }
  })
  await rehearsalReviewSummary('/tool', identity)
  expect(
    vi
      .mocked(runGitBufferBounded)
      .mock.calls.filter(([, args]) => args.includes('diff-tree'))
      .some(([, args]) => args.includes(emptyTreeSha256))
  ).toBe(true)
})
