/**
 * Which URLs count as "the app itself".
 *
 * The window only ever shows the bundled UI — the dev server in development, a
 * file:// index.html in a packaged build. A top-level navigation anywhere else
 * would replace the app with somebody else's page while leaving the preload
 * bridge exposed to it, so the guard in index.ts refuses anything this returns
 * false for (#42).
 *
 * Pure and unit-tested rather than inline in the window setup, because getting
 * it subtly wrong (matching on a prefix, say, so that
 * `http://localhost:5173.evil.com` passes) is the whole risk.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  let target: URL
  let self: URL
  try {
    target = new URL(url)
    self = new URL(appUrl)
  } catch {
    return false
  }

  // Packaged: only the exact file we loaded. Any other local file — a diff a
  // user dragged in, a path assembled from repository contents — is not the UI.
  if (self.protocol === 'file:') {
    return target.protocol === 'file:' && target.pathname === self.pathname
  }

  // Development: the dev server's own origin. Compared host-and-scheme rather
  // than by prefix, so a lookalike host cannot slip past.
  return target.protocol === self.protocol && target.host === self.host
}
