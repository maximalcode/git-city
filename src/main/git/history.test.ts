import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { blameFile, fileHistory, parseBlamePorcelain } from './history'
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

describe('parseBlamePorcelain', () => {
  it('parses headers, caches sha metadata, and reads content', () => {
    const raw = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2',
      'author Alice',
      'author-time 1700000000',
      'summary first',
      '\tline one',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2', // repeat sha, no metadata block
      '\tline two',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 3 3 1',
      'author Bob',
      'author-time 1700000500',
      'summary second',
      '\tline three'
    ].join('\n')
    const lines = parseBlamePorcelain(raw)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      lineNo: 1,
      author: 'Alice',
      text: 'line one',
      commitShort: 'aaaaaaa'
    })
    // repeated sha resolves author from the cache
    expect(lines[1]).toMatchObject({ lineNo: 2, author: 'Alice', text: 'line two' })
    expect(lines[2]).toMatchObject({ lineNo: 3, author: 'Bob', text: 'line three' })
    expect(lines[0].date).toBe(1700000000 * 1000)
  })

  it('preserves leading whitespace in content (tab-stripped only)', () => {
    const raw = [
      'cccccccccccccccccccccccccccccccccccccccc 1 1 1',
      'author X',
      'author-time 1',
      'summary s',
      '\t    indented code'
    ].join('\n')
    expect(parseBlamePorcelain(raw)[0].text).toBe('    indented code')
  })
})

describe('fileHistory + blame (real repo)', () => {
  it('returns a file history and follows a rename', async () => {
    const r = repo()
    r.write('old.txt', 'a\nb\n')
    r.commitAll('add old')
    r.write('old.txt', 'a\nb\nc\n')
    r.commitAll('grow old')
    r.git('mv', 'old.txt', 'new.txt')
    r.commitAll('rename to new')

    const hist = await fileHistory(r.path, 'new.txt')
    // --follow should reach back past the rename to both earlier commits
    const subjects = hist.map((h) => h.subject)
    expect(subjects).toContain('rename to new')
    expect(subjects).toContain('grow old')
    expect(subjects).toContain('add old')
    expect(hist[0].shortHash).toMatch(/^[0-9a-f]{7}$/)
  })

  it('blames each line to its author', async () => {
    const r = repo()
    r.write('f.txt', 'alpha\n')
    r.commitAll('a')
    r.write('f.txt', 'alpha\nbeta\n')
    r.commitAll('b')

    const lines = await blameFile(r.path, 'f.txt')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ lineNo: 1, text: 'alpha', author: 'Test' })
    expect(lines[1]).toMatchObject({ lineNo: 2, text: 'beta', author: 'Test' })
  })

  it('blames at an older rev', async () => {
    const r = repo()
    r.write('f.txt', 'alpha\n')
    r.commitAll('a')
    const first = r.git('rev-parse', 'HEAD').trim()
    r.write('f.txt', 'alpha\nbeta\n')
    r.commitAll('b')

    const lines = await blameFile(r.path, 'f.txt', first)
    expect(lines).toHaveLength(1) // beta doesn't exist yet at the first commit
    expect(lines[0].text).toBe('alpha')
  })

  it('throws on an untracked file instead of returning an empty blame', async () => {
    const r = repo()
    r.write('f.txt', 'x\n')
    r.commitAll('a')
    await expect(blameFile(r.path, 'nope.txt')).rejects.toThrow()
  })
})
