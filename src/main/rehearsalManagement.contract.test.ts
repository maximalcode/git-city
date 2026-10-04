import { expect, it, vi } from 'vitest'
import { listRehearsals, discardRehearsals } from './rehearsalManagement'
import { runRehearsalTool } from './rehearsal'

vi.mock('./rehearsal', () => ({
  rehearsalAvailability: vi.fn().mockResolvedValue({ available: true }),
  runRehearsalTool: vi.fn(),
  rehearsalShow: vi.fn(),
  rehearsalContinue: vi.fn()
}))

it.each([
  { schema: 2, rehearsals: [] },
  { schema: 1, rehearsals: [{ id: 'old-build-without-active-protection' }] },
  { schema: 1, rehearsals: 'invalid' }
])('rejects incompatible inventory before any destructive request (%j)', async (document) => {
  vi.mocked(runRehearsalTool)
    .mockReset()
    .mockResolvedValue({ code: 0, stdout: JSON.stringify(document), stderr: '' })
  await expect(listRehearsals('/tool', process.cwd())).rejects.toThrow(
    'Incompatible rehearsal inventory'
  )
  const result = await discardRehearsals('/tool', process.cwd(), [
    {
      id: 'selected',
      repository: process.cwd(),
      origin_worktree: process.cwd(),
      repository_id: 'original'
    }
  ])
  expect(result.discarded).toEqual([])
  expect(result.failures).toHaveLength(1)
  expect(
    vi.mocked(runRehearsalTool).mock.calls.every((call) => call[1].join(' ') === '--json list')
  ).toBe(true)
})
