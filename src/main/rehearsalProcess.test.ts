import { afterEach, expect, it, vi } from 'vitest'
import { runGit } from './git/exec'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { stopRehearsal, withRehearsalExecution } from './rehearsalProcess'

let repo: string
let release: (() => void) | undefined
afterEach(async () => {
  release?.()
  if (repo) {
    await stopRehearsal(repo)
    await rm(repo, { recursive: true, force: true })
  }
})

it('Stop immediately cancels preparation before any asynchronous launch work starts', async () => {
  repo = await mkdtemp(join(tmpdir(), 'git-city-pending-'))
  await runGit(repo, ['init', '-b', 'main'])
  const launch = vi.fn()
  const running = withRehearsalExecution(repo, async () => {
    launch()
    return { kind: 'error', message: 'unexpected launch' }
  })
  const stopped = await stopRehearsal(repo)
  expect(stopped.ok).toBe(true)
  expect(await running).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('before launch')
  })
  expect(launch).not.toHaveBeenCalled()
})

it('Stop during queued preparation prevents launch and waits for the request to settle', async () => {
  repo = await mkdtemp(join(tmpdir(), 'git-city-pending-'))
  await runGit(repo, ['init', '-b', 'main'])
  const preparation = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = vi.fn()
  const launch = vi.fn()
  const running = withRehearsalExecution(repo, async (execution) => {
    entered()
    await preparation
    execution.check()
    launch()
    return { kind: 'error', message: 'unexpected launch' }
  })
  await vi.waitFor(() => expect(entered).toHaveBeenCalled())
  const stopped = stopRehearsal(repo)
  release!()
  expect((await stopped).ok).toBe(true)
  expect(await running).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('before launch')
  })
  expect(launch).not.toHaveBeenCalled()
  expect((await stopRehearsal(repo)).ok).toBe(false)
})
