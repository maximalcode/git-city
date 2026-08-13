import type { GitCityApi } from '../../../shared/types'

/**
 * The one place the renderer reaches for the preload bridge.
 *
 * Everything else asks for it here instead of touching `window.gitCity`, which
 * buys two things: code that reads the repo can be handed a fake api in a test
 * (there is no `window` at all under vitest, so `'gitCity' in window` did not
 * return false — it threw), and the "is there an api?" question has one answer
 * rather than one per caller.
 */
let injected: GitCityApi | null = null

/** Install an api — a test double, or a preview shim. `null` puts the real one back. */
export function setBridge(api: GitCityApi | null): void {
  injected = api
}

/** The preload bridge, or null when the renderer runs without one (browser preview, vitest). */
export function bridge(): GitCityApi | null {
  if (injected) return injected
  if (typeof window === 'undefined' || !('gitCity' in window)) return null
  return window.gitCity
}

/** Whether the preload API exists (absent when the renderer runs in a plain browser). */
export const hasApi = (): boolean => bridge() !== null

export function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Electron prefixes IPC errors with "Error invoking remote method '...': Error:"
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}
