import { describe, expect, it } from 'vitest'
import { isAppUrl } from './appUrl'

/**
 * Each `false` here is a navigation the window must refuse. The renderer holds
 * the preload bridge, so a page that manages to load in it inherits every IPC
 * channel the app has.
 */
describe('isAppUrl', () => {
  const packaged = 'file:///Applications/Git%20City.app/Contents/renderer/index.html'
  const dev = 'http://localhost:5173'

  it('allows the packaged index it actually loaded', () => {
    expect(isAppUrl(packaged, packaged)).toBe(true)
  })

  it('refuses a different local file', () => {
    // the shape a repository could supply: any path off disk is not the UI
    expect(isAppUrl('file:///Users/me/secrets/index.html', packaged)).toBe(false)
  })

  it('refuses a remote page in a packaged build', () => {
    expect(isAppUrl('https://example.com/', packaged)).toBe(false)
  })

  it('allows any path on the dev server', () => {
    expect(isAppUrl('http://localhost:5173/index.html', dev)).toBe(true)
  })

  it('refuses a lookalike host that merely starts with the dev origin', () => {
    // the reason this is a URL comparison and not a string prefix
    expect(isAppUrl('http://localhost:5173.example.com/', dev)).toBe(false)
  })

  it('refuses a different port on the dev host', () => {
    expect(isAppUrl('http://localhost:6006/', dev)).toBe(false)
  })

  it('refuses https where the dev server is http', () => {
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
  })

  it('refuses anything that is not a URL at all', () => {
    expect(isAppUrl('javascript:alert(1)', dev)).toBe(false)
    expect(isAppUrl('', packaged)).toBe(false)
  })
})
