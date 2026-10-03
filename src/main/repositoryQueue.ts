import { realpath } from 'fs/promises'
import { runGit } from './git/exec'
import { withRepoLock } from './git/queue'

export async function commonRepository(repo: string): Promise<string> {
  return realpath(
    (await runGit(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  )
}

const previews = new Map<string, Set<Promise<unknown>>>()

/** Original-worktree writes and recovery/Undo inspection exclude previews too:
 * even the CLI's inspection commands briefly own its common Apply journal lock. */
export async function withRepositoryWrite<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const common = await commonRepository(repo)
  return withRepoLock(common, async () => {
    await Promise.allSettled(previews.get(common) ?? [])
    return fn()
  })
}

/** Admit previews through the write queue, but let linked-worktree previews run
 * together. The queue holds only admission; a later write waits for all admitted
 * previews to finish before it starts. Nothing retries a CLI command. */
export async function withRepositoryPreview<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const common = await commonRepository(repo)
  const { result } = await withRepoLock(common, async () => {
    const active = previews.get(common) ?? new Set<Promise<unknown>>()
    const result = Promise.resolve().then(fn)
    active.add(result)
    previews.set(common, active)
    const remove = (): void => {
      active.delete(result)
      if (active.size === 0) previews.delete(common)
    }
    void result.then(remove, remove)
    // Do not return the promise itself: that would hold the queue for the whole
    // preview and serialize otherwise independent linked-worktree execution.
    return { result }
  })
  return result
}
