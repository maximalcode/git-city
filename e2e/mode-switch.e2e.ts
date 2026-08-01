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

const setMode = (page: Page, mode: 'city' | 'forest'): Promise<void> =>
  page.evaluate((m) => {
    ;(
      window as unknown as {
        __gitCityMock: { store: { getState(): { setViewMode(x: string): void } } }
      }
    ).__gitCityMock.store
      .getState()
      .setViewMode(m)
  }, mode)

/** the r3f camera position via the DEV probe CameraRig exposes, or null */
const camPos = (page: Page): Promise<[number, number, number] | null> =>
  page.evaluate(() => {
    const c = (
      window as unknown as { __gitCityCam?: { position: { x: number; y: number; z: number } } }
    ).__gitCityCam
    return c ? [c.position.x, c.position.y, c.position.z] : null
  })

// the r3f scene canvas is authored before the minimap's 2D canvas, so `.first()`
// disambiguates the two `.city-root canvas` matches
const sceneCanvas = (page: Page) => page.locator('.city-root canvas').first()

/** right-drag across the middle of the canvas — MapControls orbits on it */
const dragOrbit = async (page: Page): Promise<void> => {
  const b = await sceneCanvas(page).boundingBox()
  if (!b) throw new Error('no canvas box')
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(cx + 160, cy + 50, { steps: 10 })
  await page.mouse.up({ button: 'right' })
}

const maxDelta = (a: [number, number, number], b: [number, number, number]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i])))

/** how many times the rig disposed its MapControls (DEV probe). A view-mode
 *  switch must NEVER dispose — only a real unmount does. This is the exact,
 *  deterministic signal of the "camera dead after switch" regression. */
const rigDisposes = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __gitCityRigDisposes?: number }).__gitCityRigDisposes ?? 0
  )
const resetRigDisposes = (page: Page): Promise<void> =>
  page.evaluate(() => {
    ;(window as unknown as { __gitCityRigDisposes?: number }).__gitCityRigDisposes = 0
  })

const setTheme = (page: Page, id: string): Promise<void> =>
  page.evaluate((t) => {
    ;(
      window as unknown as {
        __gitCityMock: { store: { getState(): { setTheme(x: string): void } } }
      }
    ).__gitCityMock.store
      .getState()
      .setTheme(t)
  }, id)

test('city/forest switching never freezes the render loop or errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await installDrawCounter(page)
  await page.goto('/?mock')
  await sceneCanvas(page).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __gitCityMock?: { store: { getState(): { screen: string } } }
        }
      ).__gitCityMock?.store.getState().screen === 'city'
  )

  // dismiss the first-run encoding guide (a real user clicks "Got it"); its
  // full-screen backdrop would otherwise intercept the camera drags below
  await page.evaluate(() =>
    (
      window as unknown as {
        __gitCityMock: { store: { getState(): { dismissOnboarding(): void } } }
      }
    ).__gitCityMock.store
      .getState()
      .dismissOnboarding()
  )

  // the render loop is alive at rest
  expect(await drawsOver(page, 500)).toBeGreaterThan(0)

  // Cancel the intro auto-orbit up front with a real interaction (the controls
  // are connected in city mode). Now the camera only moves in response to input,
  // so the drag check at the end is attributable to the drag and not the orbit.
  await dragOrbit(page)
  await page.waitForTimeout(600) // let damping settle
  await resetRigDisposes(page) // count only switch-induced disposes from here

  // toggle across every theme — 4 of 5 have AO, the exact path that used to
  // mutate the EffectComposer child set and stall the loop
  const themes = ['realistic-day', 'realistic-night', 'neon', 'golden-hour', 'midnight-ink']
  for (const t of themes) {
    await setTheme(page, t)
    for (let i = 0; i < 3; i++) {
      await setMode(page, i % 2 ? 'city' : 'forest')
      await page.waitForTimeout(150)
    }
  }

  // no error boundary tripped, and the loop is STILL drawing (would be 0 if frozen)
  expect(await page.locator('.scene-error').count()).toBe(0)
  await setMode(page, 'forest')
  await page.waitForTimeout(400)
  expect(await drawsOver(page, 600)).toBeGreaterThan(0)

  // DETERMINISTIC regression guard: none of those view-mode switches tore down
  // the camera controls. If the rig ever disposes on a worldSize change again,
  // this is non-zero and the camera would be dead (city citySize != forest
  // worldSize, so worldSize changes on every switch).
  expect(await rigDisposes(page), 'view-mode switches must not dispose the camera controls').toBe(0)

  // End-to-end sanity: the camera still responds to a drag after all the
  // switching (intro orbit was cancelled up front, so movement == input).
  const rest1 = await camPos(page)
  expect(rest1, 'DEV camera probe should be exposed').not.toBeNull()
  await page.waitForTimeout(400)
  const rest2 = await camPos(page)
  // with the intro orbit cancelled and no input, the camera is genuinely at rest
  expect(maxDelta(rest1!, rest2!), 'camera should be at rest before the drag').toBeLessThan(0.5)

  await dragOrbit(page)
  await page.waitForTimeout(300)
  const after = await camPos(page)
  expect(
    maxDelta(rest2!, after!),
    'camera should still respond to drag after a view-mode switch'
  ).toBeGreaterThan(2)

  expect(errors, errors.join('\n')).toEqual([])
})
