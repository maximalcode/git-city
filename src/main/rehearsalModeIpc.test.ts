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
it('does not enforce internal preferences in an unpackaged production renderer', async () => {
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
  vi.stubEnv('GIT_CITY_REHEARSE_BIN', '/configured/tool')
  expect(await getRehearsalMode('/repo')).toBeNull()
  expect(rehearsalMode).not.toHaveBeenCalled()
})
it('keeps packaged mode disabled even when development environment variables leak in', async () => {
  app.isPackaged = true
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5199')
  vi.stubEnv('GIT_CITY_REHEARSE_BIN', '/configured/tool')
  expect(await getRehearsalMode('/repo')).toBeNull()
  expect(rehearsalMode).not.toHaveBeenCalled()
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
