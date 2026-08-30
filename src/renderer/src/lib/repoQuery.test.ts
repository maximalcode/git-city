import { describe, expect, it } from 'vitest'
import { runRepoRead, type QueryPatch } from './repoQuery'

function collector(): { patches: QueryPatch<unknown>[]; emit: (p: QueryPatch<unknown>) => void } {
  const patches: QueryPatch<unknown>[] = []
  return { patches, emit: (p) => patches.push(p) }
}

/** Let every already-settled promise callback run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('runRepoRead', () => {
  it('announces the load before it announces the result', async () => {
    const { patches, emit } = collector()
    runRepoRead(async () => 'entries', emit)

    expect(patches).toEqual([{ loading: true, error: null }])

    await settle()
    expect(patches).toEqual([
      { loading: true, error: null },
      { data: 'entries', error: null },
      { loading: false }
    ])
  })

  it('cleans the failure and drops the stale data', async () => {
    const { patches, emit } = collector()
    runRepoRead(async () => {
      throw new Error("Error invoking remote method 'reflog': Error: fatal: bad object")
    }, emit)
    await settle()

    expect(patches.slice(1)).toEqual([
      { data: null, error: 'fatal: bad object' },
      { loading: false }
    ])
  })

  it('says nothing after it is cancelled — the guard every panel hand-rolled', async () => {
    const { patches, emit } = collector()
    let resolve = (_: string): void => {}
    const cancel = runRepoRead(() => new Promise<string>((r) => (resolve = r)), emit)

    cancel()
    resolve('too late')
    await settle()

    expect(patches).toEqual([{ loading: true, error: null }])
  })

  it('swallows a failure that arrives after cancellation', async () => {
    const { patches, emit } = collector()
    let reject = (_: unknown): void => {}
    const cancel = runRepoRead(() => new Promise<string>((_, r) => (reject = r)), emit)

    cancel()
    reject(new Error('boom'))
    await settle()

    expect(patches).toEqual([{ loading: true, error: null }])
  })

  it('lets a superseded read finish without touching the newer one', async () => {
    const first = collector()
    const second = collector()
    let resolveFirst = (_: string): void => {}
    const cancelFirst = runRepoRead(
      () => new Promise<string>((r) => (resolveFirst = r)),
      first.emit
    )

    cancelFirst()
    runRepoRead(async () => 'fresh', second.emit)
    resolveFirst('stale')
    await settle()

    expect(first.patches).toHaveLength(1)
    expect(second.patches).toContainEqual({ data: 'fresh', error: null })
  })

  it('reports a missing bridge as a failed read rather than crashing', async () => {
    const { patches, emit } = collector()
    runRepoRead(() => {
      throw new Error('no api')
    }, emit)
    await settle()

    expect(patches).toContainEqual({ data: null, error: 'no api' })
    expect(patches).toContainEqual({ loading: false })
  })
})
