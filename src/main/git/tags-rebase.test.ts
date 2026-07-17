import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempRepo, type FixtureRepo } from './fixtures'
import { createTag, deleteTag, listTags } from './tags'
import { getRebaseTodo, runInteractiveRebase } from './rebaseInteractive'
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

/** commits that each touch a DIFFERENT file → reordering never conflicts */
function fourCommits(): FixtureRepo {
  const r = repo()
  r.write('a.txt', 'a\n')
  r.commitAll('A')
  r.write('b.txt', 'b\n')
  r.commitAll('B')
  r.write('c.txt', 'c\n')
  r.commitAll('C')
  r.write('d.txt', 'd\n')
  r.commitAll('D')
  return r
}
const subjects = (r: FixtureRepo): string[] =>
  r.git('log', '--format=%s').trim().split('\n')

describe('tags', () => {
  it('creates, lists and deletes tags', async () => {
    const r = repo()
    r.write('a.txt', 'x\n')
    r.commitAll('init')

    expect((await createTag(r.path, 'v1.0')).ok).toBe(true)
    let tags = await listTags(r.path)
    expect(tags.map((t) => t.name)).toContain('v1.0')
    expect(tags[0].target).toMatch(/^[0-9a-f]{7}$/)

    expect((await deleteTag(r.path, 'v1.0')).ok).toBe(true)
    tags = await listTags(r.path)
    expect(tags.map((t) => t.name)).not.toContain('v1.0')
  })

  it('rejects an empty tag name', async () => {
    const r = repo()
    r.write('a.txt', 'x\n')
    r.commitAll('init')
    expect((await createTag(r.path, '  ')).ok).toBe(false)
  })
})

describe('interactive rebase', () => {
  it('drops a commit', async () => {
    const r = fourCommits()
    const { entries, base } = await getRebaseTodo(r.path, 3) // D, C, B (newest first)
    const marked = entries.map((e) => (e.subject === 'C' ? { ...e, action: 'drop' as const } : e))
    const res = await runInteractiveRebase(r.path, base, marked)
    expect(res.ok).toBe(true)
    expect(subjects(r)).toEqual(['D', 'B', 'A'])
    expect(existsSync(join(r.path, 'c.txt'))).toBe(false)
    expect((await getWorkingStatus(r.path)).opState).toBe('none')
  })

  it('reorders commits', async () => {
    const r = fourCommits()
    const { entries, base } = await getRebaseTodo(r.path, 2) // [D, C]
    // swap → [C, D] newest-first  ⇒ history top becomes C
    const swapped = [entries[1], entries[0]]
    const res = await runInteractiveRebase(r.path, base, swapped)
    expect(res.ok).toBe(true)
    expect(subjects(r).slice(0, 2)).toEqual(['C', 'D'])
  })

  it('squashes a commit into the one below it', async () => {
    const r = fourCommits()
    const { entries, base } = await getRebaseTodo(r.path, 2) // [D, C]
    // squash D into C → one combined commit; total count drops by one
    const marked = entries.map((e) => (e.subject === 'D' ? { ...e, action: 'squash' as const } : e))
    const before = subjects(r).length
    const res = await runInteractiveRebase(r.path, base, marked)
    expect(res.ok).toBe(true)
    expect(subjects(r).length).toBe(before - 1)
    // both files survive the squash
    expect(existsSync(join(r.path, 'c.txt'))).toBe(true)
    expect(existsSync(join(r.path, 'd.txt'))).toBe(true)
  })

  it('stops on conflict and leaves the repo mid-rebase', async () => {
    const r = repo()
    r.write('f.txt', 'base\n')
    r.commitAll('base')
    r.write('f.txt', 'one\n')
    r.commitAll('one')
    r.write('f.txt', 'two\n')
    r.commitAll('two')
    // reorder the two conflicting edits to force a conflict
    const { entries, base } = await getRebaseTodo(r.path, 2)
    const swapped = [entries[1], entries[0]]
    const res = await runInteractiveRebase(r.path, base, swapped)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')
    expect((await getWorkingStatus(r.path)).opState).toBe('rebase')
    // clean up so afterAll can remove the dir
    r.git('rebase', '--abort')
  })
})
