import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cherryPick,
  cherryPickAbort,
  cherryPickContinue,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto
} from './advanced'
import { resolveConflictFile } from './conflicts'
import { makeTempRepo, type FixtureRepo } from './fixtures'
import { getWorkingStatus } from './status'
import { stashApply, stashDrop, stashList, stashPop, stashPush } from './stash'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

function repo(): FixtureRepo {
  const r = makeTempRepo()
  cleanups.push(r.path)
  return r
}

describe('stash', () => {
  it('push / list / pop roundtrips content exactly', async () => {
    const r = repo()
    r.write('a.txt', 'committed\n')
    r.commitAll('initial')
    r.write('a.txt', 'work in progress\n')

    expect((await stashPush(r.path, 'my wip', false)).ok).toBe(true)
    expect(readFileSync(join(r.path, 'a.txt'), 'utf8')).toBe('committed\n')

    const list = await stashList(r.path)
    expect(list).toHaveLength(1)
    expect(list[0].message).toContain('my wip')
    expect(list[0].index).toBe(0)

    expect((await stashPop(r.path, 0)).ok).toBe(true)
    expect(readFileSync(join(r.path, 'a.txt'), 'utf8')).toBe('work in progress\n')
    expect(await stashList(r.path)).toHaveLength(0)
  })

  it('includes untracked files only when asked', async () => {
    const r = repo()
    r.write('a.txt', 'base\n')
    r.commitAll('initial')
    r.write('new.txt', 'untracked\n')

    const without = await stashPush(r.path, '', false)
    expect(without.ok).toBe(false)
    expect(without.code).toBe('nothing-to-do')

    expect((await stashPush(r.path, '', true)).ok).toBe(true)
    const s = await getWorkingStatus(r.path)
    expect(s.files).toHaveLength(0)
    expect((await stashPop(r.path, 0)).ok).toBe(true)
    expect(readFileSync(join(r.path, 'new.txt'), 'utf8')).toBe('untracked\n')
  })

  it('a conflicting pop keeps the stash entry', async () => {
    const r = repo()
    r.write('f.txt', 'base\n')
    r.commitAll('initial')
    r.write('f.txt', 'stashed version\n')
    await stashPush(r.path, 'conflicting wip', false)
    r.write('f.txt', 'committed version\n')
    r.commitAll('moved on')

    const res = await stashPop(r.path, 0)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')
    expect(await stashList(r.path)).toHaveLength(1) // entry survives

    // clean up the conflict, apply/drop path still usable
    await resolveConflictFile(r.path, 'f.txt', 'merged\n')
    expect((await stashDrop(r.path, 0)).ok).toBe(true)
    expect(await stashList(r.path)).toHaveLength(0)
  })

  it('apply keeps the entry on success', async () => {
    const r = repo()
    r.write('a.txt', 'base\n')
    r.commitAll('initial')
    r.write('a.txt', 'wip\n')
    await stashPush(r.path, 'keepme', false)
    expect((await stashApply(r.path, 0)).ok).toBe(true)
    expect(await stashList(r.path)).toHaveLength(1)
  })
})

/** main and feature diverge on the same line */
function divergedRepo(): FixtureRepo {
  const r = repo()
  r.write('f.txt', 'base\n')
  r.write('other.txt', 'stable\n')
  r.commitAll('base')
  r.git('switch', '-c', 'feature')
  r.write('f.txt', 'feature\n')
  r.commitAll('feature change')
  r.git('switch', 'main')
  r.write('f.txt', 'main\n')
  r.commitAll('main change')
  return r
}

describe('cherry-pick', () => {
  it('applies a clean commit', async () => {
    const r = repo()
    r.write('a.txt', 'base\n')
    r.commitAll('base')
    r.git('switch', '-c', 'side')
    r.write('side.txt', 'side\n')
    r.commitAll('side work')
    const hash = r.git('rev-parse', 'HEAD').trim()
    r.git('switch', 'main')

    expect((await cherryPick(r.path, hash)).ok).toBe(true)
    expect(readFileSync(join(r.path, 'side.txt'), 'utf8')).toBe('side\n')
    expect(r.git('log', '-1', '--format=%s').trim()).toBe('side work')
  })

  it('stops on conflict, then continue finishes it', async () => {
    const r = divergedRepo()
    const featureHash = r.git('rev-parse', 'feature').trim()

    const res = await cherryPick(r.path, featureHash)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')
    expect((await getWorkingStatus(r.path)).opState).toBe('cherry-pick')

    await resolveConflictFile(r.path, 'f.txt', 'resolved\n')
    expect((await cherryPickContinue(r.path)).ok).toBe(true)
    expect((await getWorkingStatus(r.path)).opState).toBe('none')
    expect(r.git('log', '-1', '--format=%s').trim()).toBe('feature change')
  })

  it('abort restores the previous state', async () => {
    const r = divergedRepo()
    const before = r.git('rev-parse', 'HEAD').trim()
    await cherryPick(r.path, r.git('rev-parse', 'feature').trim())
    expect((await cherryPickAbort(r.path)).ok).toBe(true)
    expect(r.git('rev-parse', 'HEAD').trim()).toBe(before)
    expect((await getWorkingStatus(r.path)).files).toHaveLength(0)
  })
})

describe('rebase', () => {
  it('rebases cleanly when there is no overlap', async () => {
    const r = repo()
    r.write('a.txt', 'base\n')
    r.commitAll('base')
    r.git('switch', '-c', 'feature')
    r.write('feat.txt', 'feat\n')
    r.commitAll('feature work')
    r.git('switch', 'main')
    r.write('main.txt', 'main\n')
    r.commitAll('main work')
    r.git('switch', 'feature')

    expect((await rebaseOnto(r.path, 'main')).ok).toBe(true)
    // linear: feature's commit sits on top of main's
    const subjects = r.git('log', '--format=%s').trim().split('\n')
    expect(subjects).toEqual(['feature work', 'main work', 'base'])
  })

  it('conflicted rebase: cold-start detection, resolve, continue', async () => {
    const r = divergedRepo()
    r.git('switch', 'feature')

    const res = await rebaseOnto(r.path, 'main')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('conflict')

    // a fresh status (≈ app relaunch) must still see the rebase in progress
    const s = await getWorkingStatus(r.path)
    expect(s.opState).toBe('rebase')
    expect(s.rebaseProgress).toEqual({ done: 1, total: 1 })

    await resolveConflictFile(r.path, 'f.txt', 'rebased\n')
    expect((await rebaseContinue(r.path)).ok).toBe(true)
    expect((await getWorkingStatus(r.path)).opState).toBe('none')
    const subjects = r.git('log', '--format=%s').trim().split('\n')
    expect(subjects).toEqual(['feature change', 'main change', 'base'])
  })

  it('abort restores the branch tip', async () => {
    const r = divergedRepo()
    r.git('switch', 'feature')
    const before = r.git('rev-parse', 'HEAD').trim()
    await rebaseOnto(r.path, 'main')
    expect((await rebaseAbort(r.path)).ok).toBe(true)
    expect(r.git('rev-parse', 'HEAD').trim()).toBe(before)
  })
})
