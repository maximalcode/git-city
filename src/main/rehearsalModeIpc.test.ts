import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'path'
import { getRehearsalMode } from './rehearsalModeIpc'
import { rehearsalMode } from './rehearsalMode'
const app = vi.hoisted(() => ({ isPackaged: false, getPath: () => '/user-data' }))

vi.mock('electron', () => ({ app }))
vi.mock('./rehearsalMode', () => ({ rehearsalMode: vi.fn() }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  app.isPackaged = false
})
it.each([false, true])('enables mode selection in production (packaged=%s)', async (packaged) => {
  app.isPackaged = packaged
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
  vi.stubEnv('GIT_CITY_REHEARSE_BIN', packaged ? '' : '/configured/tool')
  const setting = { repository: '/common', mode: 'automatic' as const }
  vi.mocked(rehearsalMode).mockResolvedValue(setting)
  expect(await getRehearsalMode('/repo', ['/known'])).toEqual(setting)
  expect(rehearsalMode).toHaveBeenCalledWith(
    join('/user-data', 'rehearsal-modes.json'),
    true,
    '/repo',
    ['/known'],
    undefined
  )
})
it('keeps saved preferences active in development even when the tool disappears', async () => {
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5199')
  vi.stubEnv('GIT_CITY_REHEARSE_BIN', '')
  const setting = { repository: '/common', mode: 'automatic' as const }
  vi.mocked(rehearsalMode).mockResolvedValue(setting)
  expect(await getRehearsalMode('/repo')).toEqual(setting)
  expect(rehearsalMode).toHaveBeenCalledWith(
    join('/user-data', 'rehearsal-modes.json'),
    false,
    '/repo',
    [],
    undefined
  )
})
