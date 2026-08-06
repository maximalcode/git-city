/**
 * Capture the README media from the browser preview.
 *
 * Drives the real renderer with the deterministic ?mock repo, so the shots are
 * reproducible: same city, same camera, same commit every run. Writes stills
 * and the hero animation into docs/media/.
 *
 *   npx vite -c vite.preview.config.ts &     # http://localhost:5199
 *   node scripts/capture-media.mjs
 *
 * Needs gifski on PATH for the hero GIF (brew install gifski). Without it the
 * stills are still written and the GIF step is skipped with a warning.
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199'
const OUT = resolve(process.cwd(), 'docs/media')
const FRAMES = resolve(process.cwd(), 'docs/media/.frames')

// 16:10 at 2x — wide enough to read the HUD, and gifski scales it down for the
// hero without the text turning to mush
const VIEWPORT = { width: 1280, height: 800 }
// 1.25x lands the stills at 1600px wide — sharp on a HiDPI screen, and small
// enough as JPEG that five of them cost about a megabyte in the repo
const SCALE = 1.25
const JPEG_QUALITY = 88

/** Stills worth having: both view modes, and a spread of themes and encodings. */
const STILLS = [
  { name: 'city-night', theme: 'realistic-night', view: 'city', color: 'language' },
  { name: 'city-neon', theme: 'neon', view: 'city', color: 'activity' },
  { name: 'city-author', theme: 'golden-hour', view: 'city', color: 'author' },
  { name: 'farm', theme: 'realistic-day', view: 'farm', color: 'language' },
  { name: 'farm-night', theme: 'realistic-night', view: 'farm', color: 'language' }
]

const ONLY = process.argv.includes('--stills') ? 'stills' : null

const settle = (page, ms = 2200) => page.waitForTimeout(ms)

/** Theme and view persist in localStorage; colour mode does not, so it is set on the store. */
async function prime(page, { theme, view }) {
  await page.addInitScript(
    ([theme, view]) => {
      localStorage.setItem('gitcity.theme', theme)
      localStorage.setItem('gitcity.view', view)
      localStorage.setItem('gitcity.onboarded', '1') // no first-run card over the shot
    },
    [theme, view]
  )
}

async function setColor(page, color) {
  if (!color || color === 'language') return // the default
  await page.evaluate((c) => window.__gitCityMock.store.getState().setColorMode(c), color)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  rmSync(FRAMES, { recursive: true, force: true })
  mkdirSync(FRAMES, { recursive: true })

  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ]
  })

  for (const still of STILLS) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE
    })
    const page = await ctx.newPage()
    await prime(page, still)
    await page.goto(`${BASE}/?mock`, { waitUntil: 'load' })
    await settle(page)
    await setColor(page, still.color)
    await page.waitForTimeout(900) // colour lerp
    await page.screenshot({
      path: join(OUT, `${still.name}.jpg`),
      type: 'jpeg',
      quality: JPEG_QUALITY
    })
    console.log(`stills: ${still.name}.jpg`)
    await ctx.close()
  }

  if (ONLY === 'stills') {
    await browser.close()
    return
  }

  // Hero: replay the history from the first commit while grabbing frames.
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await prime(page, { theme: 'realistic-night', view: 'city', color: 'language' })
  await page.goto(`${BASE}/?mock`, { waitUntil: 'load' })
  await settle(page)

  // rewind, then step forward so every frame is a real state of the city
  const snapshots = await page.evaluate(
    () => window.__gitCityMock.store.getState().analysis.snapshots.length
  )
  const FRAME_COUNT = 60
  for (let i = 0; i < FRAME_COUNT; i++) {
    const index = Math.min(snapshots - 1, Math.round((i / (FRAME_COUNT - 1)) * (snapshots - 1)))
    await page.evaluate((i) => window.__gitCityMock.store.getState().setSnapshotIndex(i), index)
    // let the height/colour lerp catch up so growth reads as motion, not steps
    await page.waitForTimeout(110)
    await page.screenshot({ path: join(FRAMES, `f${String(i).padStart(3, '0')}.png`) })
  }
  console.log(`hero: ${FRAME_COUNT} frames`)
  await ctx.close()
  await browser.close()

  try {
    const frames = readdirSync(FRAMES)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => join(FRAMES, f))
    execFileSync('gifski', ['-W', '900', '--fps', '12', '-o', join(OUT, 'demo.gif'), ...frames], {
      stdio: 'inherit'
    })
    rmSync(FRAMES, { recursive: true, force: true })
    console.log('hero: docs/media/demo.gif')
  } catch (err) {
    console.warn(`gifski unavailable, frames left in ${FRAMES}:`, err.message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
