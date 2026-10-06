import { afterEach, expect, it, vi } from 'vitest'
import { waitForPackagedApply } from './smoke-package-apply.mjs'

function pageShowingSuccessAfter(delayMs) {
  const started = performance.now()
  return {
    getByText: () => ({ isVisible: async () => performance.now() - started >= delayMs })
  }
}

function virtualClock() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] })
}

afterEach(() => vi.useRealTimers())

it('waits for a successful Apply that completes after the old 90-second cutoff', async () => {
  virtualClock()
  const completion = waitForPackagedApply(pageShowingSuccessAfter(225_000)).then(
    () => 'applied',
    () => 'timed out'
  )
  await vi.advanceTimersByTimeAsync(226_000)
  expect(await completion).toBe('applied')
})

it('still fails within a bounded wait when Apply never reports success', async () => {
  virtualClock()
  const completion = waitForPackagedApply(pageShowingSuccessAfter(Infinity)).then(
    () => 'unexpected success',
    () => 'timed out'
  )
  await vi.advanceTimersByTimeAsync(300_001)
  expect(await completion).toBe('timed out')
})

it('returns promptly when the exact success message is already visible', async () => {
  virtualClock()
  await waitForPackagedApply(pageShowingSuccessAfter(0))
  expect(performance.now()).toBe(0)
})
