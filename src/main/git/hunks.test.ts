import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempRepo, type FixtureRepo } from './fixtures'
import { applyHunk, applyLines, buildLinePatch, getFileHunks, splitDiff } from './hunks'
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

describe('buildLinePatch', () => {
  const hunk = '@@ -1,5 +1,5 @@\n' + ' a\n' + '-b\n' + '-c\n' + '+B\n' + '+C\n' + ' d\n' + ' e\n'

  it('keeps a selected change and neutralises the unselected one to context', () => {
    // select del 'b' (idx1) + add 'B' (idx3) → stage only the b→B change
    const patch = buildLinePatch(hunk, [1, 3])!
    expect(patch).not.toBeNull()
    expect(patch).toContain('-b')
    expect(patch).toContain('+B')
    expect(patch).toContain(' c') // unselected deletion becomes context
    expect(patch).not.toContain('+C') // unselected addition dropped
    expect(patch.startsWith('@@ -1,5 +1,5 @@')).toBe(true) // old side unchanged
  })

  it('returns null when nothing changed is selected', () => {
    expect(buildLinePatch(hunk, [])).toBeNull()
    expect(buildLinePatch(hunk, [0, 5])).toBeNull() // only context indices
  })

  it('refuses hunks with a no-newline marker (whole-hunk only)', () => {
    expect(buildLinePatch(hunk + '\\ No newline at end of file\n', [1])).toBeNull()
  })
})

/** base a..e, change b→B and c→C → a single hunk with two changes */
function twoLineEdit(): FixtureRepo {
  const r = repo()
  r.write('f.txt', 'a\nb\nc\nd\ne\n')
  r.commitAll('base')
  r.write('f.txt', 'a\nB\nC\nd\ne\n')
  return r
}

describe('applyLines', () => {
  it('stages only the selected line, leaving the other change unstaged', async () => {
    const r = twoLineEdit()
    const fh = await getFileHunks(r.path, 'f.txt', false)
    const h = fh.hunks[0]
    const delB = h.lines.findIndex((l) => l.kind === 'del' && l.text === 'b')
    const addB = h.lines.findIndex((l) => l.kind === 'add' && l.text === 'B')
    expect(delB).toBeGreaterThanOrEqual(0)
    expect(addB).toBeGreaterThanOrEqual(0)

    const res = await applyLines(r.path, 'f.txt', h.header, [delB, addB], 'stage')
    expect(res.ok).toBe(true)

    const staged = await getFileHunks(r.path, 'f.txt', true)
    const unstaged = await getFileHunks(r.path, 'f.txt', false)
    // only b→B is staged; c→C is still unstaged
    expect(staged.hunks.some((hk) => hk.lines.some((l) => l.text === 'B'))).toBe(true)
    expect(staged.hunks.some((hk) => hk.lines.some((l) => l.text === 'C'))).toBe(false)
    expect(unstaged.hunks.some((hk) => hk.lines.some((l) => l.text === 'C'))).toBe(true)
  })

  it('errors when the selection neutralises to nothing', async () => {
    const r = twoLineEdit()
    const fh = await getFileHunks(r.path, 'f.txt', false)
    const ctxIdx = fh.hunks[0].lines.findIndex((l) => l.kind === 'ctx')
    const res = await applyLines(r.path, 'f.txt', fh.hunks[0].header, [ctxIdx], 'stage')
    expect(res.ok).toBe(false)
  })
})
