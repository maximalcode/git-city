import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  bestEffort,
  capturePageEvidence,
  diagnosticDeadlines,
  withDeadline
} from './smoke-package-diagnostics.mjs'

describe('smoke-package diagnostics', () => {
  it('withDeadline releases a forever-pending observer at the shared deadline', async () => {
    vi.useFakeTimers()
    const pending = withDeadline(() => new Promise(() => {}), Date.now() + 100, 'expired')
    try {
      await vi.advanceTimersByTimeAsync(99)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toBe('expired')
    } finally {
      vi.useRealTimers()
    }
  })

  it('bestEffort preserves the fallback when capture throws', async () => {
    const original = new Error('original assertion')
    const result = await bestEffort(async () => {
      throw original
    }, 'capture failed')
    expect(result).toBe('capture failed')
  })

  it('grace zero still reserves initial and final capture windows', () => {
    const deadlines = diagnosticDeadlines(1_000, 0)
    expect(deadlines.initialDeadline).toBe(6_000)
    expect(deadlines.observationDeadline).toBe(1_000)
    expect(deadlines.finalDeadline).toBe(11_000)
  })

  it('final timing window remains after the full observation budget', () => {
    const deadlines = diagnosticDeadlines(1_000, 180_000)
    expect(deadlines.observationDeadline).toBe(181_000)
    expect(deadlines.finalDeadline).toBe(191_000)
  })

  it('page evidence capture never throws when directory or page capture fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-city-diagnostics-test-'))
    const file = join(root, 'regular-file')
    await writeFile(file, 'occupied')
    try {
      await expect(
        capturePageEvidence(
          {
            screenshot: async () => {
              throw new Error('screenshot failed')
            },
            content: async () => {
              throw new Error('content failed')
            }
          },
          join(file, 'child'),
          'original-timeout',
          Date.now() + 100
        )
      ).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
