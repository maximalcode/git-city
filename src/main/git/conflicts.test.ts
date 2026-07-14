import { readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseConflictSegments, readConflictFile, resolveConflictFile, resolveWholeFile } from './conflicts'
import { makeTempRepo, type FixtureRepo } from './fixtures'
import { mergeAbort, mergeBranch, mergeContinue } from './merge'
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

/** base commit → feature branch edit → main edit → conflicting merge started */
function conflictedRepo(eol = '\n'): FixtureRepo {
  const r = repo()
  r.write('f.txt', `line1${eol}base${eol}line3${eol}`)
  r.commitAll('base')
  r.git('switch', '-c', 'feature')
  r.write('f.txt', `line1${eol}from feature${eol}line3${eol}`)
  r.commitAll('feature edit')
  r.git('switch', 'main')
  r.write('f.txt', `line1${eol}from main${eol}line3${eol}`)
  r.commitAll('main edit')
  try {
    r.git('merge', 'feature')
  } catch {
    // expected: conflict
  }
  return r
}

describe('parseConflictSegments', () => {
  it('splits text and conflict hunks with labels', () => {
    const content = 'top\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nbottom\n'
    const segs = parseConflictSegments(content)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ kind: 'text', text: 'top\n' })
    expect(segs[1]).toMatchObject({
      kind: 'conflict',
      ours: 'mine\n',
      theirs: 'theirs\n',
      oursLabel: 'HEAD',
      theirsLabel: 'feature'
    })
    expect(segs[2]).toEqual({ kind: 'text', text: 'bottom\n' })
  })

  it('parses the diff3 base section', () => {
    const content =
      '<<<<<<< HEAD\nmine\n||||||| merged common ancestors\noriginal\n=======\nyours\n>>>>>>> other\n'
    const segs = parseConflictSegments(content)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ kind: 'conflict', base: 'original\n' })
  })

  it('preserves CRLF line endings byte-for-byte', () => {
    const content = 'a\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\nyours\r\n>>>>>>> b\r\nz\r\n'
    const segs = parseConflictSegments(content)
    expect(segs[0]).toEqual({ kind: 'text', text: 'a\r\n' })
    expect(segs[1]).toMatchObject({ ours: 'mine\r\n', theirs: 'yours\r\n' })
    expect(segs[2]).toEqual({ kind: 'text', text: 'z\r\n' })
  })

  it('falls back to one text segment on unbalanced markers', () => {
    const content = 'a\n<<<<<<< HEAD\ndangling\n'
    const segs = parseConflictSegments(content)
    expect(segs).toEqual([{ kind: 'text', text: content }])
  })

  it('handles multiple conflicts with increasing ids', () => {
    const content =
      '<<<<<<< a\n1\n=======\n2\n>>>>>>> b\nmid\n<<<<<<< a\n3\n=======\n4\n>>>>>>> b\n'
    const segs = parseConflictSegments(content).filter((s) => s.kind === 'conflict')
    expect(segs).toHaveLength(2)
    expect(segs.map((s) => (s.kind === 'conflict' ? s.id : -1))).toEqual([0, 1])
  })
})

describe('conflict resolution end to end', () => {
  it('reads, resolves and continues a real merge conflict', async () => {
    const r = conflictedRepo()
    const file = await readConflictFile(r.path, 'f.txt')
    expect(file.binary).toBe(false)
    const conflict = file.segments.find((s) => s.kind === 'conflict')
    expect(conflict).toBeDefined()

    // resolve as "both"
    const resolved = 'line1\nfrom main\nfrom feature\nline3\n'
    expect((await resolveConflictFile(r.path, 'f.txt', resolved)).ok).toBe(true)

    let s = await getWorkingStatus(r.path)
    expect(s.files.every((f) => !f.conflicted)).toBe(true)
    expect(s.opState).toBe('merge')

    expect((await mergeContinue(r.path)).ok).toBe(true)
    s = await getWorkingStatus(r.path)
    expect(s.opState).toBe('none')
    expect(readFileSync(join(r.path, 'f.txt'), 'utf8')).toBe(resolved)
    // merge commit has two parents
    expect(r.git('rev-list', '--parents', '-1', 'HEAD').trim().split(' ')).toHaveLength(3)
  })

  it('preserves CRLF content through resolution', async () => {
    const r = conflictedRepo('\r\n')
    const file = await readConflictFile(r.path, 'f.txt')
    const seg = file.segments.find((s) => s.kind === 'conflict')
    expect(seg).toBeDefined()
    if (seg?.kind !== 'conflict') return
    expect(seg.ours.endsWith('\r\n')).toBe(true)

    // assemble "ours" resolution exactly like the UI does: concatenate segments
    const text = file.segments
      .map((s) => (s.kind === 'text' ? s.text : s.ours))
      .join('')
    await resolveConflictFile(r.path, 'f.txt', text)
    const bytes = readFileSync(join(r.path, 'f.txt'))
    expect(bytes.toString('utf8')).toBe('line1\r\nfrom main\r\nline3\r\n')
  })

  it('aborting a merge restores a clean tree', async () => {
    const r = conflictedRepo()
    expect((await mergeAbort(r.path)).ok).toBe(true)
    const s = await getWorkingStatus(r.path)
    expect(s.opState).toBe('none')
    expect(s.files).toHaveLength(0)
    expect(readFileSync(join(r.path, 'f.txt'), 'utf8')).toBe('line1\nfrom main\nline3\n')
  })

  it('binary conflicts are detected and resolvable whole-file', async () => {
    const r = repo()
    const bin = (fill: number): Buffer => {
      const b = Buffer.alloc(64, fill)
      b[1] = 0 // NUL byte → binary
      return b
    }
    writeFileSync(join(r.path, 'blob.bin'), bin(1))
    r.commitAll('base')
    r.git('switch', '-c', 'feature')
    writeFileSync(join(r.path, 'blob.bin'), bin(2))
    r.commitAll('feature blob')
    r.git('switch', 'main')
    writeFileSync(join(r.path, 'blob.bin'), bin(3))
    r.commitAll('main blob')

    const merge = await mergeBranch(r.path, 'feature')
    expect(merge.ok).toBe(false)
    expect(merge.code).toBe('conflict')
    expect(merge.conflicts).toContain('blob.bin')

    const file = await readConflictFile(r.path, 'blob.bin')
    expect(file.binary).toBe(true)

    expect((await resolveWholeFile(r.path, 'blob.bin', 'theirs')).ok).toBe(true)
    expect(readFileSync(join(r.path, 'blob.bin'))[0]).toBe(2)
    expect((await mergeContinue(r.path)).ok).toBe(true)
  })

  it('mergeBranch reports conflicted paths', async () => {
    const r = repo()
    r.write('f.txt', 'base\n')
    r.commitAll('base')
    r.git('switch', '-c', 'other')
    r.write('f.txt', 'other\n')
    r.commitAll('other edit')
    r.git('switch', 'main')
    r.write('f.txt', 'main\n')
    r.commitAll('main edit')

    const res = await mergeBranch(r.path, 'other')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')
    expect(res.conflicts).toEqual(['f.txt'])
  })
})
