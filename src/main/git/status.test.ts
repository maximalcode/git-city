import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import { makeRepoPair, makeTempRepo } from './fixtures'
import { getWorkingStatus, parsePorcelainV2 } from './status'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

function repo(): ReturnType<typeof makeTempRepo> {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

describe('parsePorcelainV2', () => {
  it('parses rename records whose orig path is a separate NUL token', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
      'old name.txt',
      '? extra file.txt'
    ].join('\0')
    const parsed = parsePorcelainV2(raw)
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]).toMatchObject({
      path: 'new name.txt',
      origPath: 'old name.txt',
      index: 'renamed',
      worktree: 'unmodified'
    })
    expect(parsed.files[1]).toMatchObject({ path: 'extra file.txt', worktree: 'untracked' })
  })

  it('flags a gone upstream with behind = -1', () => {
    const raw = ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main'].join(
      '\0'
    )
    const parsed = parsePorcelainV2(raw)
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.behind).toBe(-1)
  })
})

describe('getWorkingStatus', () => {
  it('reports untracked, modified and staged files', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')

    r.write('a.txt', 'one\ntwo\n') // modified, unstaged
    r.write('b.txt', 'new\n') // untracked
    r.write('c.txt', 'staged\n')
    r.git('add', 'c.txt') // staged new file

    const s = await getWorkingStatus(r.path)
    expect(s.branch).toBe('main')
    expect(s.opState).toBe('none')
    expect(s.headHash).toMatch(/^[0-9a-f]{40}$/)
    const by = new Map(s.files.map((f) => [f.path, f]))
    expect(by.get('a.txt')).toMatchObject({ index: 'unmodified', worktree: 'modified' })
    expect(by.get('b.txt')).toMatchObject({ worktree: 'untracked' })
    expect(by.get('c.txt')).toMatchObject({ index: 'added', worktree: 'unmodified' })
  })

  it('reports a real rename', async () => {
    const r = repo()
    r.write('first.txt', 'content that is long enough to be tracked as a rename\n')
    r.commitAll('initial')
    r.git('mv', 'first.txt', 'second.txt')

    const s = await getWorkingStatus(r.path)
    const renamed = s.files.find((f) => f.index === 'renamed')
    expect(renamed).toBeDefined()
    expect(renamed!.path).toBe('second.txt')
    expect(renamed!.origPath).toBe('first.txt')
  })

  it('detects merge conflicts and opState merge', async () => {
    const r = repo()
    r.write('f.txt', 'base\n')
    r.commitAll('base')
    r.git('switch', '-c', 'feature')
    r.write('f.txt', 'feature\n')
    r.commitAll('feature change')
    r.git('switch', 'main')
    r.write('f.txt', 'main\n')
    r.commitAll('main change')
    expect(() => r.git('merge', 'feature')).toThrow()

    const s = await getWorkingStatus(r.path)
    expect(s.opState).toBe('merge')
    const f = s.files.find((x) => x.path === 'f.txt')
    expect(f?.conflicted).toBe(true)
  })

  it('reports detached HEAD', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('first')
    r.write('a.txt', 'two\n')
    r.commitAll('second')
    r.git('checkout', 'HEAD~1')

    const s = await getWorkingStatus(r.path)
    expect(s.branch).toBeNull()
    expect(s.detachedAt).toMatch(/^[0-9a-f]{7}$/)
  })

  it('works in a repo with no commits yet', async () => {
    const r = repo()
    r.write('a.txt', 'hello\n')
    const s = await getWorkingStatus(r.path)
    expect(s.headHash).toBe('')
    expect(s.files.find((f) => f.path === 'a.txt')?.worktree).toBe('untracked')
  })

  it('reports ahead/behind against a real upstream', async () => {
    const pair = makeRepoPair()
    cleanups.push(pair.origin.replace(/origin\.git$/, ''))

    pair.a.write('a-work.txt', 'from a\n')
    pair.a.commitAll('a commit')
    pair.a.git('push', 'origin', 'main')

    pair.b.write('b-work.txt', 'from b\n')
    pair.b.commitAll('b commit')
    pair.b.git('fetch', 'origin')

    const s = await getWorkingStatus(pair.b.path)
    expect(s.upstream).toBe('origin/main')
    expect(s.ahead).toBe(1)
    expect(s.behind).toBe(1)
    expect(s.remotes).toEqual([{ name: 'origin', url: expect.stringContaining('origin.git') }])
  }, 30_000)

  it('counts stashes', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')
    r.write('a.txt', 'dirty\n')
    r.git('stash', 'push', '-m', 'wip')
    const s = await getWorkingStatus(r.path)
    expect(s.stashCount).toBe(1)
  })
})
