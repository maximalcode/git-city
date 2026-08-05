import { rmSync } from 'fs'
import { dirname } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { createBranch, deleteBranch, listBranches, switchBranch } from './branches'
import { makeCloneWithRemoteBranches, makeRepoPair, makeTempRepo, type RepoPair } from './fixtures'
import { getWorkingStatus } from './status'
import { fetchRemote, pullRemote, pushRemote } from './sync'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

function pair(): RepoPair {
  const p = makeRepoPair()
  cleanups.push(dirname(p.origin))
  return p
}

const noop = (): void => {}

describe('sync against a local bare origin', () => {
  it('push → fetch shows behind → pull fast-forwards', async () => {
    const p = pair()

    p.a.write('feature.txt', 'from a\n')
    p.a.commitAll('a adds feature')
    const push = await pushRemote(p.a.path, false, noop)
    expect(push.ok).toBe(true)

    const fetch = await fetchRemote(p.b.path, noop)
    expect(fetch.ok).toBe(true)
    let s = await getWorkingStatus(p.b.path)
    expect(s.behind).toBe(1)
    expect(s.ahead).toBe(0)

    const pull = await pullRemote(p.b.path, noop)
    expect(pull.ok).toBe(true)
    s = await getWorkingStatus(p.b.path)
    expect(s.behind).toBe(0)
    expect(p.b.git('log', '-1', '--format=%s').trim()).toBe('a adds feature')
  }, 60_000)

  it('diverged push is rejected — and never force-pushed', async () => {
    const p = pair()

    p.a.write('x.txt', 'a\n')
    p.a.commitAll('a work')
    expect((await pushRemote(p.a.path, false, noop)).ok).toBe(true)

    p.b.write('y.txt', 'b\n')
    p.b.commitAll('b work')
    const res = await pushRemote(p.b.path, false, noop)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('rejected')

    // origin still has a's commit as tip — b's rejected push changed nothing
    const originTip = p.a.git('ls-remote', 'origin', 'main')
    expect(originTip).toContain(p.a.git('rev-parse', 'HEAD').trim())
  }, 60_000)

  it('publishes a branch with no upstream via setUpstream', async () => {
    const p = pair()
    p.a.git('switch', '-c', 'topic')
    p.a.write('t.txt', 'topic\n')
    p.a.commitAll('topic work')

    const plain = await pushRemote(p.a.path, false, noop)
    expect(plain.ok).toBe(false)
    expect(plain.code).toBe('no-upstream')

    const publish = await pushRemote(p.a.path, true, noop)
    expect(publish.ok).toBe(true)
    const s = await getWorkingStatus(p.a.path)
    expect(s.upstream).toBe('origin/topic')
  }, 60_000)

  /**
   * `-u origin HEAD` fails with an essay about refnames whose first line is a
   * transport line, so the toast said nothing about the real problem: you are
   * not on a branch (#26).
   */
  it('says you are not on a branch instead of pushing a detached HEAD', async () => {
    const p = pair()
    p.a.write('x.txt', 'one\n')
    p.a.commitAll('one')
    p.a.git('checkout', '--detach', 'HEAD')

    const res = await pushRemote(p.a.path, true, noop)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('detached HEAD')
    // friendly, so the UI does not replace it with the generic no-upstream text
    expect(res.friendly).toBe(true)
  }, 60_000)

  it('surfaces a clean error when the remote is unreachable', async () => {
    const p = pair()
    rmSync(p.origin, { recursive: true, force: true })
    const res = await fetchRemote(p.a.path, noop)
    expect(res.ok).toBe(false)
    expect(res.message).toBeTruthy()
    expect(res.gitOutput).toBeTruthy()
  }, 60_000)
})

describe('branches', () => {
  it('lists branches with upstream tracking and current flag', async () => {
    const p = pair()
    p.a.write('w.txt', 'w\n')
    p.a.commitAll('local ahead commit')
    p.a.git('switch', '-c', 'side')

    const branches = await listBranches(p.a.path)
    const main = branches.find((b) => b.name === 'main')
    const side = branches.find((b) => b.name === 'side')
    expect(main).toMatchObject({ upstream: 'origin/main', ahead: 1, behind: 0, current: false })
    expect(side).toMatchObject({ current: true, upstream: null })
    expect(main!.lastCommitSubject).toBe('local ahead commit')
  }, 60_000)

  it('refuses to switch over dirty conflicting changes with code dirty', async () => {
    const r = makeTempRepo()
    cleanups.push(r.path)
    r.write('f.txt', 'main\n')
    r.commitAll('main version')
    r.git('switch', '-c', 'other')
    r.write('f.txt', 'other\n')
    r.commitAll('other version')
    r.git('switch', 'main')
    r.write('f.txt', 'dirty edit\n')

    const res = await switchBranch(r.path, 'other')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('dirty')
  })

  it('shows remote-tracking branches in a fresh clone (only default is local)', async () => {
    const r = makeCloneWithRemoteBranches(['feature/sync', 'hotfix', 'docs', 'experiment'])
    cleanups.push(r.path.replace(/clone$/, ''))

    const branches = await listBranches(r.path)
    const names = branches.map((b) => b.name)
    // the real bug: these are refs/remotes/origin/* on a fresh clone
    expect(names).toContain('origin/feature/sync')
    expect(names).toContain('origin/hotfix')
    expect(names).toContain('origin/docs')
    expect(names).toContain('origin/experiment')
    expect(branches.find((b) => b.name === 'origin/hotfix')?.isRemote).toBe(true)
    // the local default is present and current, and origin/HEAD is filtered out
    expect(branches.find((b) => b.name === 'main')).toMatchObject({
      current: true,
      isRemote: false
    })
    expect(names).not.toContain('origin/HEAD')
    // origin/main is deduped away (a local 'main' already tracks it)
    expect(names).not.toContain('origin/main')
  }, 60_000)

  it('checks out a remote branch as a new local tracking branch', async () => {
    const r = makeCloneWithRemoteBranches(['feature/sync'])
    cleanups.push(r.path.replace(/clone$/, ''))

    const res = await switchBranch(r.path, 'origin/feature/sync')
    expect(res.ok).toBe(true)
    expect(r.git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/sync')
    // it tracks the remote
    expect(r.git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim()).toBe(
      'origin/feature/sync'
    )
  }, 60_000)

  it('creates, switches and deletes branches with not-merged safety', async () => {
    const r = makeTempRepo()
    cleanups.push(r.path)
    r.write('a.txt', 'one\n')
    r.commitAll('initial')

    expect((await createBranch(r.path, 'exp', true)).ok).toBe(true)
    r.write('exp.txt', 'exp\n')
    r.commitAll('exp work')
    expect((await switchBranch(r.path, 'main')).ok).toBe(true)

    const soft = await deleteBranch(r.path, 'exp', false)
    expect(soft.ok).toBe(false)
    expect(soft.code).toBe('not-merged')

    expect((await deleteBranch(r.path, 'exp', true)).ok).toBe(true)
    const branches = await listBranches(r.path)
    expect(branches.map((b) => b.name)).toEqual(['main'])
  })
})
