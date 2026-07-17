import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { getFileDiff, parseUnifiedDiff } from './diff'
import { makeTempRepo, type FixtureRepo } from './fixtures'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})
function repo(): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

describe('parseUnifiedDiff', () => {
  it('splits hunks into typed lines and counts add/del', () => {
    const raw = [
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old line',
      '+new line',
      ' tail'
    ].join('\n')
    const p = parseUnifiedDiff(raw)
    expect(p.binary).toBe(false)
    expect(p.hunks).toHaveLength(1)
    expect(p.additions).toBe(1)
    expect(p.deletions).toBe(1)
    expect(p.hunks[0].lines).toEqual([
      { kind: 'ctx', text: 'keep' },
      { kind: 'del', text: 'old line' },
      { kind: 'add', text: 'new line' },
      { kind: 'ctx', text: 'tail' }
    ])
  })

  it('ignores the pre-hunk header block', () => {
    const raw = 'diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+hi'
    const p = parseUnifiedDiff(raw)
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0].lines).toEqual([{ kind: 'add', text: 'hi' }])
  })

  it('detects binary diffs', () => {
    const p = parseUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ')
    expect(p.binary).toBe(true)
    expect(p.hunks).toHaveLength(0)
  })

  it('drops the "no newline at end of file" marker', () => {
    const raw = '@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file'
    const p = parseUnifiedDiff(raw)
    expect(p.hunks[0].lines).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'b' }
    ])
  })
})

describe('getFileDiff', () => {
  it('shows uncommitted changes vs HEAD', async () => {
    const r = repo()
    r.write('a.txt', 'one\ntwo\n')
    r.commitAll('initial')
    r.write('a.txt', 'one\nTWO\nthree\n')

    const d = await getFileDiff(r.path, 'a.txt')
    expect(d.title).toBe('Uncommitted changes')
    expect(d.additions).toBeGreaterThan(0)
    const added = d.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add')
    expect(added.some((l) => l.text === 'three')).toBe(true)
  })

  it('falls back to the last change for a clean file', async () => {
    const r = repo()
    r.write('a.txt', 'hello\n')
    r.commitAll('add a')
    r.write('a.txt', 'hello\nworld\n')
    r.commitAll('grow a')

    const d = await getFileDiff(r.path, 'a.txt')
    expect(d.title).toMatch(/^Last change/)
    const added = d.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add')
    expect(added.some((l) => l.text === 'world')).toBe(true)
  })

  it('shows the change a specific commit introduced', async () => {
    const r = repo()
    r.write('a.txt', 'v1\n')
    r.commitAll('first')
    r.write('a.txt', 'v1\nv2\n')
    r.commitAll('second')
    const hash = r.git('rev-parse', 'HEAD').trim()

    const d = await getFileDiff(r.path, 'a.txt', { rev: hash })
    expect(d.title).toBe(`commit ${hash.slice(0, 7)}`)
    const added = d.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add')
    expect(added.some((l) => l.text === 'v2')).toBe(true)
  })

  it('throws on a bad rev instead of returning a silent empty diff', async () => {
    const r = repo()
    r.write('a.txt', 'x\n')
    r.commitAll('init')
    await expect(
      getFileDiff(r.path, 'a.txt', { rev: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })
    ).rejects.toThrow(/no longer exist/)
  })

  it('shows an untracked file as all additions', async () => {
    const r = repo()
    r.write('a.txt', 'base\n')
    r.commitAll('initial')
    r.write('fresh.txt', 'brand\nnew\n')

    const d = await getFileDiff(r.path, 'fresh.txt')
    expect(d.title).toMatch(/New file/)
    const added = d.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add')
    expect(added.map((l) => l.text)).toEqual(expect.arrayContaining(['brand', 'new']))
  })
})
