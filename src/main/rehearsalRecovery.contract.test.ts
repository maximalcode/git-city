import { beforeEach, expect, it, vi } from 'vitest'
import { rehearsalAvailability, runRehearsalTool } from './rehearsal'
import { inspectRecovery } from './rehearsalRecovery'

vi.mock('./rehearsal', () => ({ rehearsalAvailability: vi.fn(), runRehearsalTool: vi.fn() }))
beforeEach(() => {
  vi.mocked(rehearsalAvailability).mockResolvedValue({
    available: true,
    configured: true,
    message: ''
  })
})

it.each([
  { schema: 99, state: 'after_ref_change', rehearsal: 'id', operation: 'apply' },
  { schema: 1, state: 'future_state', rehearsal: 'id', operation: 'apply' },
  { schema: 1, state: 'none' },
  { schema: 1, state: 'after_ref_change' },
  { schema: 1, kind: 'refused', message: 'Damaged journal; index.lock must not trigger a retry' }
])(
  'blocks unsupported recovery documents without offering repair actions (%j)',
  async (document) => {
    vi.mocked(runRehearsalTool)
      .mockClear()
      .mockResolvedValue({
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          repository: process.cwd(),
          action: 'inspect',
          can_complete: true,
          can_rollback: true,
          ...document
        })
      })
    const recovery = await inspectRecovery('/configured/tool', process.cwd())
    expect(recovery.state).toBe('unknown')
    expect(recovery.can_complete).toBe(false)
    expect(recovery.can_rollback).toBe(false)
    expect(runRehearsalTool).toHaveBeenCalledExactlyOnceWith(
      '/configured/tool',
      ['--json', 'recover'],
      process.cwd()
    )
  }
)

it('tolerates optional additions to a valid recovery status', async () => {
  vi.mocked(runRehearsalTool).mockResolvedValue({
    code: 0,
    stderr: '',
    stdout: JSON.stringify({
      schema: 1,
      repository: process.cwd(),
      action: 'inspect',
      state: 'none',
      can_complete: false,
      can_rollback: false,
      message: 'An optional explanation'
    })
  })
  expect((await inspectRecovery('/configured/tool', process.cwd())).state).toBe('none')
})
