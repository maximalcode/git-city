import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitCityApi } from '../../../shared/types'
import { bridge, cleanError } from './bridge'

/**
 * Reading something about the repository, once.
 *
 * Seven panels each grew their own copy of the same twenty lines: a `cancelled`
 * flag, a `retryNonce`, `cleanError`, loading/error state, and a dependency list
 * that decided when the read had gone stale — and those dependency lists
 * disagreed with each other (#106). This is that block, written once.
 *
 * Mutations still go through the store; this is only the read path.
 */
export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export type QueryPatch<T> = Partial<QueryState<T>>

export interface RepoQuery<T> extends QueryState<T> {
  /** Run the read again — what every panel's retry button used to bump a nonce for. */
  reload: () => void
}

const IDLE = { data: null, loading: false, error: null } as const

/**
 * Run one read, reporting its progress through `emit`. Returns a cancel
 * function; after it is called nothing is emitted again, so a response that
 * lands after the panel moved on is dropped rather than shown.
 */
export function runRepoRead<T>(
  read: () => Promise<T>,
  emit: (patch: QueryPatch<T>) => void
): () => void {
  let cancelled = false
  emit({ loading: true, error: null })
  // Promise.resolve().then so a read that throws synchronously (no bridge, a
  // bad argument) lands in the same catch as one that rejects.
  void Promise.resolve()
    .then(read)
    .then((data) => {
      if (!cancelled) emit({ data, error: null })
    })
    .catch((err) => {
      if (!cancelled) emit({ data: null, error: cleanError(err) })
    })
    .finally(() => {
      if (!cancelled) emit({ loading: false })
    })
  return (): void => {
    cancelled = true
  }
}

/**
 * Read something about the repo, keyed on the arguments it is read with.
 *
 * `args` is both the dependency list and what `read` is called with, so a panel
 * cannot silently forget to refetch when one of them changes — and a staleness
 * trigger that isn't an argument (HEAD's hash, the working-tree fingerprint) is
 * declared by putting it in the tuple, where it is visible. `null` means "not
 * now" and resets the query to empty.
 *
 * `read` is called with the bridge; when there is none (browser preview) the
 * query stays idle instead of failing.
 */
export function useRepoQuery<A extends readonly unknown[], T>(
  args: A | null,
  // NoInfer: the tuple decides the type, so `read` can destructure just the
  // entries it needs and ignore the staleness triggers.
  read: (api: GitCityApi, args: NoInfer<A>) => Promise<T>
): RepoQuery<T> {
  const [state, setState] = useState<QueryState<T>>(IDLE)
  const [nonce, setNonce] = useState(0)

  // args are primitives, so their serialisation is the dependency key; the refs
  // keep the effect off the identity of a callback that is new every render.
  const key = args === null ? null : JSON.stringify(args)
  const argsRef = useRef(args)
  argsRef.current = args
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    const current = argsRef.current
    const api = bridge()
    if (key === null || current === null || !api) {
      setState(IDLE)
      return
    }
    return runRepoRead<T>(
      () => readRef.current(api, current),
      (patch) => setState((prev) => ({ ...prev, ...patch }))
    )
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}
