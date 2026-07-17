import { describe, expect, it } from 'vitest'
import { withRepoLock } from './queue'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('withRepoLock', () => {
  it('serializes operations on the same repo in call order', async () => {
    const order: number[] = []
    const slow = withRepoLock('C:/repo-a', async () => {
      await sleep(40)
      order.push(1)
    })
    const fast = withRepoLock('C:/repo-a', async () => {
      order.push(2)
    })
    await Promise.all([slow, fast])
    expect(order).toEqual([1, 2])
  })

  it('a rejected operation does not poison the queue', async () => {
    const boom = withRepoLock('C:/repo-b', async () => {
      throw new Error('boom')
    })
    await expect(boom).rejects.toThrow('boom')
    // the next op on the same repo still runs (and resolves)
    await expect(withRepoLock('C:/repo-b', async () => 'fine')).resolves.toBe('fine')
  })

  it('treats path case/slash variants as the same repo', async () => {
    const order: number[] = []
    const a = withRepoLock('C:\\Repo-C', async () => {
      await sleep(40)
      order.push(1)
    })
    const b = withRepoLock('c:/repo-c', async () => {
      order.push(2)
    })
    await Promise.all([a, b])
    expect(order).toEqual([1, 2])
  })

  it('different repos run concurrently', async () => {
    const order: string[] = []
    const a = withRepoLock('C:/repo-d', async () => {
      await sleep(60)
      order.push('slow-d')
    })
    const b = withRepoLock('C:/repo-e', async () => {
      order.push('fast-e')
    })
    await Promise.all([a, b])
    // repo-e was NOT queued behind repo-d
    expect(order).toEqual(['fast-e', 'slow-d'])
  })

  it('returns the operation result', async () => {
    await expect(withRepoLock('C:/repo-f', async () => 42)).resolves.toBe(42)
  })
})
