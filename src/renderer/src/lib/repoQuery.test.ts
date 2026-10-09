import { describe, expect, it, vi } from 'vitest'
import type {
  GitCityApi,
  RehearsalReviewFileResult,
  RehearsalReviewFileView
} from '../../../shared/types'
import { runRepoRead, type QueryPatch } from './repoQuery'
import {
  authoritativeRehearsalReviewTotal,
  validateRehearsalReviewFileResponse
} from './rehearsalReviewResponses'

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

  it('drops a late frozen-review response after the request key changes', async () => {
    let finish!: (value: string) => void
    const patches: string[] = []
    const cancel = runRepoRead(
      () => new Promise<string>((resolve) => (finish = resolve)),
      (patch) => {
        if (patch.data !== undefined && patch.data !== null) patches.push(patch.data)
      }
    )
    cancel()
    await Promise.resolve()
    finish('old revision')
    await Promise.resolve()
    await Promise.resolve()
    expect(patches).toEqual([])
  })

  it('allows the current request to publish while an older request is cancelled', async () => {
    let finishOld!: (value: string) => void
    let finishCurrent!: (value: string) => void
    const patches: string[] = []
    const cancelOld = runRepoRead(
      () => new Promise<string>((resolve) => (finishOld = resolve)),
      (patch) => {
        if (patch.data !== undefined && patch.data !== null) patches.push(patch.data)
      }
    )
    cancelOld()
    runRepoRead(
      () => new Promise<string>((resolve) => (finishCurrent = resolve)),
      (patch) => {
        if (patch.data !== undefined && patch.data !== null) patches.push(patch.data)
      }
    )
    await Promise.resolve()
    finishOld('stale')
    finishCurrent('current')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(patches).toEqual(['current'])
  })

  it('drops a stale frozen-review bridge response when entry and view change', async () => {
    let finishOld!: (value: RehearsalReviewFileResult) => void
    const reviewFile = vi.fn<GitCityApi['rehearsalReviewFile']>()
    reviewFile
      .mockImplementationOnce(
        () => new Promise<RehearsalReviewFileResult>((resolve) => (finishOld = resolve))
      )
      .mockResolvedValueOnce(reviewFileResult('new-entry', 'after'))

    const identity = {
      id: 'review-1',
      repository: '/repo',
      origin_worktree: '/repo',
      repository_id: 'repo'
    }
    const received: string[] = []
    const cancelOld = runRepoRead(
      () =>
        reviewFile(identity, 'revision-1', 'tracked-worktree', 'old-entry', 'before').then(
          (result) => result.text ?? ''
        ),
      (patch) => {
        if (patch.data !== undefined && patch.data !== null) received.push(patch.data)
      }
    )
    await Promise.resolve()
    cancelOld()

    runRepoRead(
      () =>
        reviewFile(identity, 'revision-1', 'tracked-worktree', 'new-entry', 'after').then(
          (result) => result.text ?? ''
        ),
      (patch) => {
        if (patch.data !== undefined && patch.data !== null) received.push(patch.data)
      }
    )
    finishOld(reviewFileResult('old-entry', 'before'))
    await settle()

    expect(received).toEqual(['new-entry:after'])
    expect(reviewFile).toHaveBeenNthCalledWith(
      1,
      identity,
      'revision-1',
      'tracked-worktree',
      'old-entry',
      'before'
    )
    expect(reviewFile).toHaveBeenNthCalledWith(
      2,
      identity,
      'revision-1',
      'tracked-worktree',
      'new-entry',
      'after'
    )
  })

  it('rejects a bridge response whose frozen entry or view does not match the request', () => {
    const identity = {
      id: 'review-1',
      repository: '/repo',
      origin_worktree: '/repo',
      repository_id: 'repo'
    }
    expect(() =>
      validateRehearsalReviewFileResponse(
        reviewFileResult('old-entry', 'before'),
        identity,
        'revision-1',
        'tracked-worktree',
        'new-entry',
        'after'
      )
    ).toThrow('stale')
  })

  it('keeps an established review total while a later page is pending', () => {
    expect(authoritativeRehearsalReviewTotal(null, null)).toBeNull()
    expect(authoritativeRehearsalReviewTotal(null, 101)).toBe(101)
    expect(authoritativeRehearsalReviewTotal({ total: 0 }, 101)).toBe(0)
    expect(authoritativeRehearsalReviewTotal({ total: null }, 101)).toBeNull()
  })
})

function reviewFileResult(
  entryId: string,
  view: RehearsalReviewFileView
): RehearsalReviewFileResult {
  const side = { present: true, mode: '100644', objectId: 'a'.repeat(40) }
  return {
    identity: {
      id: 'review-1',
      repository: '/repo',
      origin_worktree: '/repo',
      repository_id: 'repo'
    },
    reviewRevision: 'revision-1',
    scopeId: 'tracked-worktree',
    entryId,
    view,
    availability: 'available',
    text: `${entryId}:${view}`,
    hunks: [],
    entry: {
      entryId,
      change: 'modified',
      oldPath: 'file.txt',
      newPath: 'file.txt',
      old: side,
      new: side,
      binary: false,
      type: 'text',
      text: { changes: 'available', before: 'available', after: 'available' },
      lines: { before: 1, after: 1, additions: 1, deletions: 1 }
    }
  }
}
