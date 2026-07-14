import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { commit, getLastCommitMessage } from './commit'
import { makeTempRepo } from './fixtures'
import { discardFiles, stageFiles, unstageFiles } from './stage'
import { getWorkingStatus } from './status'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

function repo(): ReturnType<typeof makeTempRepo> {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

describe('stage / unstage / discard', () => {
  it('stages and unstages a modified file', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')
    r.write('a.txt', 'changed\n')

    expect((await stageFiles(r.path, ['a.txt'])).ok).toBe(true)
    let s = await getWorkingStatus(r.path)
    expect(s.files.find((f) => f.path === 'a.txt')).toMatchObject({
      index: 'modified',
      worktree: 'unmodified'
    })

    expect((await unstageFiles(r.path, ['a.txt'])).ok).toBe(true)
    s = await getWorkingStatus(r.path)
    expect(s.files.find((f) => f.path === 'a.txt')).toMatchObject({
      index: 'unmodified',
      worktree: 'modified'
    })
  })

  it('stages a deletion', async () => {
    const r = repo()
    r.write('gone.txt', 'bye\n')
    r.commitAll('initial')
    rmSync(join(r.path, 'gone.txt'))
    expect((await stageFiles(r.path, ['gone.txt'])).ok).toBe(true)
    const s = await getWorkingStatus(r.path)
    expect(s.files.find((f) => f.path === 'gone.txt')?.index).toBe('deleted')
  })

  it('discard restores tracked content and deletes untracked files', async () => {
    const r = repo()
    r.write('keep.txt', 'original\n')
    r.commitAll('initial')
    r.write('keep.txt', 'scribbled\n')
    r.write('junk.txt', 'temp\n')

    const res = await discardFiles(r.path, ['keep.txt', 'junk.txt'])
    expect(res.ok).toBe(true)
    expect(readFileSync(join(r.path, 'keep.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(r.path, 'junk.txt'))).toBe(false)
  })

  it('discard never deletes a tracked file the renderer mislabeled', async () => {
    const r = repo()
    r.write('important.txt', 'valuable\n')
    r.commitAll('initial')
    // no worktree change: discard should be a harmless no-op restore
    const res = await discardFiles(r.path, ['important.txt'])
    expect(res.ok).toBe(true)
    expect(readFileSync(join(r.path, 'important.txt'), 'utf8')).toBe('valuable\n')
  })
})

describe('commit', () => {
  it('commits staged changes and clears the status', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')
    r.write('a.txt', 'two\n')
    await stageFiles(r.path, ['a.txt'])

    const res = await commit(r.path, 'my change', false)
    expect(res.ok).toBe(true)
    const s = await getWorkingStatus(r.path)
    expect(s.files).toHaveLength(0)
    expect(await getLastCommitMessage(r.path)).toBe('my change')
  })

  it('amends the previous commit message', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('typo mesage')
    const res = await commit(r.path, 'fixed message', true)
    expect(res.ok).toBe(true)
    expect(await getLastCommitMessage(r.path)).toBe('fixed message')
    expect(r.git('rev-list', '--count', 'HEAD').trim()).toBe('1')
  })

  it('rejects an empty message client-side', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')
    const res = await commit(r.path, '   ', false)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('nothing-to-do')
  })

  it('reports nothing-to-do when nothing is staged', async () => {
    const r = repo()
    r.write('a.txt', 'one\n')
    r.commitAll('initial')
    const res = await commit(r.path, 'empty', false)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('nothing-to-do')
  })
})
