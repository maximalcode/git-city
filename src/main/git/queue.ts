/**
 * Per-repo operation queue. Every mutating git operation runs through here so
 * two of our own commands never race for .git/index.lock.
 */
const queues = new Map<string, Promise<unknown>>()

export function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const key = repoPath.replace(/\\/g, '/').toLowerCase()
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(
    key,
    next.catch(() => undefined)
  )
  return next
}
