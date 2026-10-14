import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerRehearsalNavigationGuard, requestRehearsalNavigation } from './rehearsalNavigation'

afterEach(() => {
  // Each test owns its registration; this clears the module-level singleton.
  registerRehearsalNavigationGuard(async () => true)()
})

describe('rehearsal navigation guard', () => {
  it('allows navigation when no editor is mounted', async () => {
    expect(await requestRehearsalNavigation('switch repositories')).toBe(true)
  })

  it('passes the requested action to the mounted editor and supports rejection', async () => {
    const guard = vi.fn<(action: string) => Promise<boolean>>().mockResolvedValue(false)
    const unregister = registerRehearsalNavigationGuard(guard)

    await expect(requestRehearsalNavigation('switch repositories')).resolves.toBe(false)
    expect(guard).toHaveBeenCalledWith('switch repositories')

    unregister()
    await expect(requestRehearsalNavigation('return to the welcome screen')).resolves.toBe(true)
  })
})
