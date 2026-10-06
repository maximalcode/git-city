import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  bestEffort,
  capturePageEvidence,
  collectFailureDiagnostics,
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

  it('grace zero still writes final IPC timing evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-city-diagnostics-zero-'))
    const directory = join(root, 'evidence')
    const error = new Error('original assertion')
    const events = []
    const app = {
      evaluate: async () => {
        events.push('main')
        return { installed: true, records: [], ipcRecords: [] }
      }
    }
    const page = {
      screenshot: async () => events.push('screenshot'),
      content: async () => {
        events.push('content')
        return '<main />'
      }
    }
    try {
      const result = await collectFailureDiagnostics({
        app,
        page,
        repo: join(root, 'repo'),
        profile: join(root, 'profile'),
        directory,
        error,
        graceMs: 0
      })
      expect(result.failure).toBe(error)
      await expect(access(join(directory, 'after-grace-apply-ipc.json'))).resolves.toBeUndefined()
      expect(events.filter((event) => event === 'main')).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads final IPC state before slower evidence after grace expires', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'git-city-diagnostics-final-'))
    const directory = join(root, 'evidence')
    const error = new Error('original assertion')
    const events = []
    let reads = 0
    let screenshots = 0
    const app = {
      evaluate: async () => {
        reads += 1
        events.push(`main-${reads}`)
        const applied = reads >= 2
        return {
          installed: true,
          records: [],
          ipcRecords: applied
            ? [
                { phase: 'start', id: 'fixture' },
                { phase: 'result', id: 'fixture', kind: 'applied' }
              ]
            : [{ phase: 'start', id: 'fixture' }]
        }
      }
    }
    const page = {
      screenshot: async () => {
        screenshots += 1
        events.push(`screenshot-${screenshots}`)
      },
      content: async () => {
        events.push('content')
        return '<main />'
      }
    }
    try {
      const pending = collectFailureDiagnostics({
        app,
        page,
        repo: join(root, 'repo'),
        profile: join(root, 'profile'),
        directory,
        error,
        graceMs: 1_000
      })
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await pending
      expect(result.failure).toBe(error)
      const ipc = JSON.parse(await readFile(join(directory, 'after-grace-apply-ipc.json'), 'utf8'))
      expect(ipc.ipcRecords.at(-1).kind).toBe('applied')
      expect(events.indexOf('main-2')).toBeLessThan(events.indexOf('screenshot-2'))
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('observer errors never replace the original failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-city-diagnostics-error-'))
    const error = new Error('original assertion')
    const app = {
      evaluate: async () => {
        throw new Error('dead main process')
      }
    }
    try {
      const result = await collectFailureDiagnostics({
        app,
        page: {},
        repo: join(root, 'repo'),
        profile: join(root, 'profile'),
        directory: join(root, 'evidence'),
        error,
        graceMs: 0
      })
      expect(result.failure).toBe(error)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('continues observing after an unavailable initial IPC read when Apply was requested', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'git-city-diagnostics-late-apply-'))
    const directory = join(root, 'evidence')
    const error = new Error('original assertion')
    let reads = 0
    let captures = 0
    const app = {
      evaluate: async () => {
        reads += 1
        if (reads === 1) throw new Error('main evaluate unavailable')
        const applied = reads >= 3
        return {
          installed: true,
          records: [],
          ipcRecords: applied
            ? [
                { phase: 'start', id: 'late' },
                { phase: 'result', id: 'late', kind: 'applied' }
              ]
            : [{ phase: 'start', id: 'late' }]
        }
      }
    }
    const page = {
      screenshot: async () => {
        captures += 1
      },
      content: async () => '<main />'
    }
    try {
      const pending = collectFailureDiagnostics({
        app,
        page,
        repo: join(root, 'repo'),
        profile: join(root, 'profile'),
        directory,
        error,
        graceMs: 5_000,
        applyRequested: true
      })
      await vi.waitFor(() => expect(captures).toBeGreaterThanOrEqual(1))
      await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(3), { timeout: 10_000 })
      const result = await pending
      expect(result.failure).toBe(error)
      const ipc = JSON.parse(await readFile(join(directory, 'after-grace-apply-ipc.json'), 'utf8'))
      expect(ipc.ipcRecords.at(-1).kind).toBe('applied')
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })
})
