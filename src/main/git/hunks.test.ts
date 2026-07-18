import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempRepo, type FixtureRepo } from './fixtures'
import { applyHunk, getFileHunks, splitDiff } from './hunks'
import { getWorkingStatus } from './status'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})
function repo(): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

/** ten numbered lines committed, then edits at the top and bottom → two hunks */
function twoHunkEdit(): FixtureRepo {
  const r = repo()
  const base = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  r.write('f.txt', base)
  r.commitAll('base')
  const edited = base.replace('line 1', 'LINE ONE').replace('line 10', 'LINE TEN')
  r.write('f.txt', edited)
  return r
}

describe('splitDiff', () => {
  it('separates the file header from each hunk', () => {
    const raw =
      'diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n' +
      '@@ -1,2 +1,2 @@\n-a\n+A\n b\n' +
      '@@ -9,2 +9,2 @@\n c\n-d\n+D\n'
    const { header, hunks } = splitDiff(raw)
    expect(header).toContain('--- a/f')
    expect(header).not.toContain('@@')
    expect(hunks).toHaveLength(2)
    expect(hunks[0].startsWith('@@ -1,2 +1,2 @@')).toBe(true)
    expect(hunks[1].startsWith('@@ -9,2 +9,2 @@')).toBe(true)
    // reassembling header + a hunk yields an applyable patch
    expect((header + hunks[0]).endsWith('\n')).toBe(true)
  })

  it('returns no hunks for header-only input', () => {
    expect(splitDiff('diff --git a/f b/f\n').hunks).toHaveLength(0)
  })
})

describe('getFileHunks', () => {
  it('lists the unstaged hunks with typed lines and counts', async () => {
    const r = twoHunkEdit()
    const fh = await getFileHunks(r.path, 'f.txt', false)
    expect(fh.binary).toBe(false)
    expect(fh.hunks).toHaveLength(2)
    expect(fh.hunks[0].header.startsWith('@@')).toBe(true)
    expect(fh.hunks[0].additions).toBe(1)
    expect(fh.hunks[0].deletions).toBe(1)
    expect(fh.hunks[0].lines.some((l) => l.kind === 'add' && l.text === 'LINE ONE')).toBe(true)
  })
})

describe('applyHunk', () => {
  it('stages only the chosen hunk, leaving the other unstaged', async () => {
    const r = twoHunkEdit()
    const fh = await getFileHunks(r.path, 'f.txt', false)
    const first = fh.hunks[0].header

    expect((await applyHunk(r.path, 'f.txt', first, 'stage')).ok).toBe(true)

    // staged diff now contains the top edit, unstaged still has the bottom one
    const staged = await getFileHunks(r.path, 'f.txt', true)
    const unstaged = await getFileHunks(r.path, 'f.txt', false)
    expect(staged.hunks).toHaveLength(1)
    expect(staged.hunks[0].lines.some((l) => l.text === 'LINE ONE')).toBe(true)
    expect(unstaged.hunks).toHaveLength(1)
    expect(unstaged.hunks[0].lines.some((l) => l.text === 'LINE TEN')).toBe(true)

    const status = await getWorkingStatus(r.path)
    const f = status.files.find((x) => x.path === 'f.txt')!
    expect(f.index).not.toBe('unmodified') // partially staged
    expect(f.worktree).not.toBe('unmodified')
  })

  it('unstages a single staged hunk', async () => {
    const r = twoHunkEdit()
    r.git('add', 'f.txt') // stage everything
    const staged = await getFileHunks(r.path, 'f.txt', true)
    expect(staged.hunks).toHaveLength(2)

    expect((await applyHunk(r.path, 'f.txt', staged.hunks[0].header, 'unstage')).ok).toBe(true)
    const after = await getFileHunks(r.path, 'f.txt', true)
    expect(after.hunks).toHaveLength(1)
  })

  it('discards a single hunk from the working tree', async () => {
    const r = twoHunkEdit()
    const fh = await getFileHunks(r.path, 'f.txt', false)
    expect((await applyHunk(r.path, 'f.txt', fh.hunks[0].header, 'discard')).ok).toBe(true)
    // the top edit is gone, the bottom one remains
    const content = r.git('show', ':f.txt') // index === worktree for this path now? read worktree
    void content
    const remaining = await getFileHunks(r.path, 'f.txt', false)
    expect(remaining.hunks).toHaveLength(1)
    expect(remaining.hunks[0].lines.some((l) => l.text === 'LINE TEN')).toBe(true)
    expect(remaining.hunks.some((h) => h.lines.some((l) => l.text === 'LINE ONE'))).toBe(false)
  })

  it('fails cleanly when the hunk no longer matches', async () => {
    const r = twoHunkEdit()
    const res = await applyHunk(r.path, 'f.txt', '@@ -999,1 +999,1 @@', 'stage')
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/moved/i)
  })
})
