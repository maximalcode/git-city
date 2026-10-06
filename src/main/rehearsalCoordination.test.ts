import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { runGit } from './git/exec'
import { withRepoLock } from './git/queue'
import { rehearseMerge } from './rehearsal'
import { withRepositoryWrite } from './repositoryQueue'
import { runRehearsalTool, stopRehearsal, withRehearsalExecution } from './rehearsalProcess'

vi.mock('./git/queue', async (original) => ({
  ...(await original<typeof import('./git/queue')>()),
  withRepoLock: vi.fn((await original<typeof import('./git/queue')>()).withRepoLock)
}))
vi.mock('./rehearsalProcess', async (original) => ({
  ...(await original<typeof import('./rehearsalProcess')>()),
  runRehearsalTool: vi.fn()
}))

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
let root: string
const releases: (() => void)[] = []
const running: Promise<unknown>[] = []
function hold() {
  const gate = barrier()
  releases.push(gate.release)
  return gate
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'git-city-coordination-')))
  await runGit(root, ['init', '-b', 'main'])
  await runGit(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '--allow-empty',
    '-m',
    'base'
  ])
  vi.mocked(withRepoLock).mockClear()
  vi.mocked(runRehearsalTool).mockReset()
})
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  await Promise.allSettled(running.splice(0))
  await rm(root, { recursive: true, force: true })
})

it.each(['same worktree', 'linked worktree'])(
  'waits for post-Apply inspection before the next preview in the %s',
  async (worktree) => {
    const repo = worktree === 'same worktree' ? root : join(root, 'linked')
    if (repo !== root) await runGit(root, ['worktree', 'add', '-b', 'linked', repo])
    const inspecting = hold()
    const entered = barrier()
    let ownsJournal = false
    const inspection = withRepositoryWrite(root, async () => {
      ownsJournal = true
      entered.release()
      await inspecting.promise
      ownsJournal = false
    })
    running.push(inspection)
    await entered.promise
    vi.mocked(runRehearsalTool).mockImplementation(async (_tool, args) => ({
      code: ownsJournal && args[0] === '--json' ? 3 : 0,
      stderr: '',
      stdout:
        args[0] === '--version'
          ? 'git-rehearse 1.3.0'
          : JSON.stringify(
              ownsJournal
                ? {
                    schema: 1,
                    kind: 'refused',
                    message:
                      'apply recovery is blocked: another process owns the live apply journal'
                  }
                : {
                    schema: 1,
                    id: 'next',
                    repository: repo,
                    origin_worktree: repo,
                    repository_id: 'repo',
                    command: ['merge', 'topic'],
                    checkout: { kind: 'branch', target: 'main' },
                    pre_state: {},
                    lifecycle: 'kept',
                    decision: 'kept',
                    outcome: 'clean',
                    execution: 'clean',
                    exit_code: 0,
                    conflicted: false,
                    drift_unexpected: false,
                    refs: [],
                    conflicts: [],
                    drift: []
                  }
            )
    }))
    const next = rehearseMerge('/tool', repo, 'topic')
    running.push(next)
    // Observe queue admission without a timing-dependent sleep. A preview that
    // bypasses the queue returns the same refusal as the real CLI overlap.
    await Promise.race([
      vi.waitFor(() => expect(withRepoLock).toHaveBeenCalledTimes(2)),
      next.then((result) => expect(result.kind).toBe('report'))
    ])
    expect(runRehearsalTool).not.toHaveBeenCalled()
    inspecting.release()
    expect((await next).kind).toBe('report')
    expect(runRehearsalTool).toHaveBeenCalledTimes(2)
  }
)

it('keeps linked-worktree previews concurrent and makes inspection wait for both', async () => {
  const linked = join(root, 'linked')
  await runGit(root, ['worktree', 'add', '-b', 'linked', linked])
  const first = hold()
  const second = hold()
  const started = [barrier(), barrier()]
  for (const [index, repo] of [root, linked].entries()) {
    const preview = withRehearsalExecution(repo, async () => {
      started[index].release()
      await [first, second][index].promise
      return { kind: 'error', message: 'fixture completed' }
    })
    running.push(preview)
  }
  await Promise.all(started.map((item) => item.promise))
  const inspect = vi.fn(async () => undefined)
  const inspection = withRepositoryWrite(root, inspect)
  running.push(inspection)
  await vi.waitFor(() => expect(withRepoLock).toHaveBeenCalledTimes(3))
  expect(inspect).not.toHaveBeenCalled()
  first.release()
  await running[0]
  expect(inspect).not.toHaveBeenCalled()
  second.release()
  await inspection
  expect(inspect).toHaveBeenCalledOnce()
})

it('Stop cancels a preview waiting for inspection without launching it', async () => {
  const inspecting = hold()
  const entered = barrier()
  running.push(
    withRepositoryWrite(root, async () => {
      entered.release()
      await inspecting.promise
    })
  )
  await entered.promise
  const launch = vi.fn(async () => ({ kind: 'error' as const, message: 'unexpected launch' }))
  const next = withRehearsalExecution(root, launch)
  running.push(next)
  await vi.waitFor(() => expect(withRepoLock).toHaveBeenCalledTimes(2))
  const stopped = stopRehearsal(root)
  running.push(stopped)
  expect((await stopped).ok).toBe(true)
  expect(await next).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('before launch')
  })
  expect(launch).not.toHaveBeenCalled()
  expect((await stopRehearsal(root)).ok).toBe(false)
  inspecting.release()
  await withRepositoryWrite(root, async () => undefined)
  expect(launch).not.toHaveBeenCalled()
})

it('releases failed previews and inspections without blocking the next operation', async () => {
  expect(
    await withRehearsalExecution(root, async () => {
      throw new Error('preview failed')
    })
  ).toMatchObject({ kind: 'error', message: 'preview failed' })
  await expect(
    withRepositoryWrite(root, async () => {
      throw new Error('inspection failed')
    })
  ).rejects.toThrow('inspection failed')
  expect(
    await withRehearsalExecution(root, async () => ({
      kind: 'refused',
      message: 'external CLI lock owner'
    }))
  ).toEqual({ kind: 'refused', message: 'external CLI lock owner' })
  await expect(withRepositoryWrite(root, async () => 'ready')).resolves.toBe('ready')
})

it('does not delay an unrelated repository behind inspection', async () => {
  const other = join(root, 'other')
  await runGit(root, ['init', '-b', 'main', other])
  const inspecting = hold()
  const entered = barrier()
  running.push(
    withRepositoryWrite(root, async () => {
      entered.release()
      await inspecting.promise
    })
  )
  await entered.promise
  expect(
    await withRehearsalExecution(other, async () => ({
      kind: 'error',
      message: 'independent preview completed'
    }))
  ).toMatchObject({ message: 'independent preview completed' })
})
