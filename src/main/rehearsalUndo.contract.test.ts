import { beforeEach, expect, it, vi } from 'vitest'
import { rehearsalAvailability, runRehearsalTool } from './rehearsal'
import { inspectUndo } from './rehearsalUndo'

vi.mock('./rehearsal', () => ({ rehearsalAvailability: vi.fn(), runRehearsalTool: vi.fn() }))
beforeEach(() => {
  vi.mocked(rehearsalAvailability).mockResolvedValue({
    available: true,
    configured: true,
    message: ''
  })
})
it.each([
  { schema: 99 },
  { rehearsal: null },
  { worktree: null },
  { applied_at_unix: null },
  { repository: '/missing-origin' },
  { available: 'yes' }
])('fails closed for an incompatible Undo status (%j)', async (override) => {
  vi.mocked(runRehearsalTool)
    .mockClear()
    .mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        schema: 1,
        repository: process.cwd(),
        rehearsal: 'exact-id',
        worktree: process.cwd(),
        applied_at_unix: 123,
        available: true,
        reason: null,
        exit_code: 0,
        ...override
      })
    })
  expect((await inspectUndo('/tool', process.cwd())).available).toBe(false)
  expect(runRehearsalTool).toHaveBeenCalledExactlyOnceWith(
    '/tool',
    ['--json', 'undo', '--check'],
    process.cwd()
  )
})
