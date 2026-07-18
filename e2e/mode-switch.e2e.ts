import { test, expect, type Page } from '@playwright/test'

// Count GPU draw calls in the page so a frozen render loop is observable.
// Patches getContext before any page script runs, so it wraps whatever WebGL
// context react-three-fiber creates.
const installDrawCounter = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const w = window as unknown as { __draws: number }
    w.__draws = 0
    const proto = HTMLCanvasElement.prototype
    const orig = proto.getContext
    proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = (orig as any).call(this, type, ...rest)
      if (ctx && (type === 'webgl2' || type === 'webgl') && !ctx.__patched) {
        ctx.__patched = true
        const de = ctx.drawElements.bind(ctx)
        const da = ctx.drawArrays.bind(ctx)
        ctx.drawElements = (...a: unknown[]) => {
          w.__draws++
          return de(...a)
        }
        ctx.drawArrays = (...a: unknown[]) => {
          w.__draws++
          return da(...a)
        }
      }
      return ctx
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  })
}

const draws = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __draws: number }).__draws)

/** draw calls counted over `ms` — 0 means the render loop is frozen */
const drawsOver = async (page: Page, ms: number): Promise<number> => {
  const before = await draws(page)
  await page.waitForTimeout(ms)
  return (await draws(page)) - before
}

const setMode = (page: Page, mode: 'city' | 'fleet'): Promise<void> =>
  page.evaluate((m) => {
    ;(
      window as unknown as { __gitCityMock: { store: { getState(): { setViewMode(x: string): void } } } }
    ).__gitCityMock.store.getState().setViewMode(m)
  }, mode)

const setTheme = (page: Page, id: string): Promise<void> =>
  page.evaluate((t) => {
    ;(
      window as unknown as { __gitCityMock: { store: { getState(): { setTheme(x: string): void } } } }
    ).__gitCityMock.store.getState().setTheme(t)
  }, id)

test('city/fleet switching never freezes the render loop or errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await installDrawCounter(page)
  await page.goto('/?mock')
  await page.waitForSelector('.city-root canvas', { timeout: 20_000 })
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __gitCityMock?: { store: { getState(): { screen: string } } }
        }
      ).__gitCityMock?.store.getState().screen === 'city'
  )

  // the render loop is alive at rest
  expect(await drawsOver(page, 500)).toBeGreaterThan(0)

  // toggle across every theme — 4 of 5 have AO, the exact path that used to
  // mutate the EffectComposer child set and stall the loop
  const themes = ['realistic-day', 'realistic-night', 'neon', 'golden-hour', 'midnight-ink']
  for (const t of themes) {
    await setTheme(page, t)
    for (let i = 0; i < 3; i++) {
      await setMode(page, i % 2 ? 'city' : 'fleet')
      await page.waitForTimeout(150)
    }
  }

  // no error boundary tripped, and the loop is STILL drawing (would be 0 if frozen)
  expect(await page.locator('.scene-error').count()).toBe(0)
  await setMode(page, 'fleet')
  await page.waitForTimeout(200)
  expect(await drawsOver(page, 600)).toBeGreaterThan(0)

  expect(errors, errors.join('\n')).toEqual([])
})
