#!/usr/bin/env node
/**
 * Screenshots the real Electron app, driving a real repository.
 *
 * The sibling script, capture-media.mjs, shoots the browser preview against
 * synthetic data. That is the right tool for the scene stills: it is
 * deterministic, so the same commit always produces the same city. It cannot
 * shoot the git client. Its files are named file0.ts and file1a.tsx, its repo
 * lives at C:/mock/mock-repo, and every panel that fetches its own data
 * (diff, graph, reflog, branches, stashes, pull requests) is gated behind
 * hasApi(), which is false outside Electron.
 *
 * So this script launches the built app instead. Every label in every
 * screenshot is real, and by default the repository it opens is this one.
 *
 *   npm run build          # out/main/index.js is what gets launched
 *   npm run media:app
 *   npm run media:app -- --only=changes,graph
 *   npm run media:app -- --list
 *   npm run media:app -- --repo=/path/to/some/other/repo
 *
 * Notes on how it drives the app:
 *
 * - Nothing is exposed on window in a production build, so there is no store
 *   handle to poke. Every shot is set up the way a user would: seeded
 *   localStorage, the app's own hotkeys, and clicks on its own controls. If a
 *   selector here breaks, the UI moved.
 * - The window is sized to 1600x1000 and captured with scale: 'css', so output
 *   matches capture-media.mjs exactly. On a retina display Chromium still
 *   renders at 2x and downsamples, so text comes out better than a 1x render.
 * - One launch, one repository analysis, all shots. Relaunching per shot would
 *   pay the history replay over again each time.
 */
import { _electron as electron } from 'playwright'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const OUT = join(ROOT, 'docs', 'media')

/** Matches capture-media.mjs so old and new shots look like one set. */
const SIZE = { width: 1600, height: 1000 }
const QUALITY = 88

/**
 * @typedef {object} Shot
 * @property {string}   name     output basename → docs/media/<name>.<jpg|png>
 * @property {string}   [theme]  theme id (default 'realistic-night')
 * @property {'city'|'farm'} [view]  (default 'city')
 * @property {string}   [color]  colour-mode id, see COLORS (default 'language')
 * @property {string[]} [keys]   hotkeys pressed in order once the scene is up
 * @property {(page: import('playwright').Page) => Promise<void>} [setup]
 * @property {number}   [hold]   extra ms before the shutter (default 900)
 * @property {boolean}  [png]    PNG instead of JPEG — for panel-dominated shots,
 *                               where JPEG rings around small UI text
 */

/** @type {Shot[]} */
const SHOTS = [
  // ── Scene ────────────────────────────────────────────────────────────────
  { name: 'app-city-night', theme: 'realistic-night', color: 'language' },
  { name: 'app-city-activity', theme: 'neon', color: 'activity' },
  { name: 'app-farm-night', theme: 'realistic-night', view: 'farm', color: 'language' },

  // ── The git client ───────────────────────────────────────────────────────
  // Lit themes behind the panels on purpose. This repository is 260 files, and
  // at night that reads as a black rectangle next to the panel rather than as
  // a city.
  {
    name: 'app-changes',
    theme: 'realistic-day',
    keys: ['c'],
    hold: 1400,
    png: true
  },
  {
    name: 'app-palette',
    theme: 'golden-hour',
    setup: async (page) => {
      await page.keyboard.press('ControlOrMeta+k')
      await page.waitForTimeout(400)
      await page.keyboard.type('branch', { delay: 40 })
    },
    hold: 700,
    png: true
  },
  {
    name: 'app-graph',
    theme: 'realistic-day',
    keys: ['g'],
    hold: 2200,
    png: true
  },
  {
    name: 'app-reflog',
    theme: 'golden-hour',
    keys: ['u'],
    hold: 1800,
    png: true
  }
]

const { values: flags } = parseArgs({
  options: {
    only: { type: 'string' },
    repo: { type: 'string' },
    list: { type: 'boolean' },
    out: { type: 'string' }
  },
  allowPositionals: false
})

if (flags.list) {
  for (const s of SHOTS) console.log(s.name)
  process.exit(0)
}

const outDir = flags.out ? resolve(flags.out) : OUT
const repo = resolve(flags.repo ?? ROOT)
const wanted = flags.only ? new Set(flags.only.split(',').map((s) => s.trim())) : null
const shots = wanted ? SHOTS.filter((s) => wanted.has(s.name)) : SHOTS

if (wanted) {
  const unknown = [...wanted].filter((n) => !SHOTS.some((s) => s.name === n))
  if (unknown.length) {
    console.error(`unknown shot(s): ${unknown.join(', ')}\ntry --list`)
    process.exit(1)
  }
}
if (!existsSync(MAIN)) {
  console.error(`no build at ${MAIN}\nrun: npm run build`)
  process.exit(1)
}
if (!existsSync(join(repo, '.git'))) {
  console.error(`not a git repository: ${repo}`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

// Shots are written to a staging directory outside the repository, then moved
// in once the app has closed. Writing straight into docs/media would land
// inside the working tree the app is watching, and every screenshot would make
// the next one show a "History changed" pill in the top bar.
const stage = mkdtempSync(join(tmpdir(), 'git-city-media-'))

/** The three HUD pickers, left to right. */
const PICKER = { view: 0, color: 1, theme: 2 }

/** Menu order, which is the order of the source arrays these are built from. */
const THEMES = ['realistic-day', 'realistic-night', 'neon', 'golden-hour', 'midnight-ink']
const COLORS = ['language', 'activity', 'author', 'recency', 'size', 'filetype']

/**
 * Open one of the HUD pickers and choose the item at `item`.
 *
 * Chosen by index rather than by label on purpose. Menu labels carry an emoji
 * prefix ('☾ Night') and colour items append their hint text, so no single text
 * anchor matches both menus.
 */
async function pick(page, picker, item) {
  await page.locator('.hud-right .picker > button.active').nth(picker).click()
  await page.locator('.picker-menu [role=menuitem]').nth(item).click()
  await page.waitForTimeout(900) // colour and height lerps are timed eases, no signal to await
}

/** Dismiss whatever is open, innermost first, so shots do not leak into each other. */
async function reset(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
  }
}

const app = await electron.launch({ args: [MAIN] })
let failed = 0

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Size the real window. Playwright's setViewportSize is a no-op on Electron.
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(size.width, size.height)
    win.center()
  }, SIZE)

  // Seed preferences, then reload so the store reads them at construction.
  // gitcity.recent is what puts the repository on the welcome screen; clicking
  // that entry is the only way in without a native folder dialog.
  await page.evaluate((r) => {
    localStorage.setItem('gitcity.recent', JSON.stringify([r]))
    localStorage.setItem('gitcity.onboarded', '1')
    localStorage.setItem('gitcity.theme', 'realistic-night')
    localStorage.setItem('gitcity.view', 'city')
  }, repo)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  console.log(`opening ${repo} …`)
  await page.locator('.recent-item').first().click()

  // The history replay is the slow part; it scales with commits x files.
  // window.__gitCitySceneReadyMs would be the precise signal, but CameraRig
  // only sets it under import.meta.env.DEV and this is a production build.
  // The timeline only mounts once the analysis has landed, so it says the same
  // thing from the outside.
  await page.waitForSelector('canvas', { timeout: 180_000 })
  await page.waitForSelector('.timeline-row', { timeout: 180_000 })
  await page.waitForTimeout(3000) // intro orbit + the first height/colour lerp
  console.log('scene ready')

  // If the repository moved while the app was starting — likely, since capture
  // runs tend to follow a commit — the top bar carries a "History changed"
  // pill. Take it up rather than hide it: one re-analysis and the shots are of
  // current history.
  // Re-analysis is itself slow enough that the watcher can raise the pill again
  // while the first one is still running, so take it up until it stays down.
  for (let i = 0; i < 5; i++) {
    const stale = page.locator('.stale-pill')
    if (!(await stale.count())) break
    console.log('history moved, re-analysing …')
    await stale.first().click()
    await page.waitForTimeout(8000)
  }
  if (await page.locator('.stale-pill').count()) {
    console.warn('warning: the "History changed" pill is still up and will be in every shot.')
    console.warn('         commit or stash your work, then run this again.')
  }

  let currentView = 'city'

  for (const shot of shots) {
    try {
      await reset(page)

      if (shot.theme) await pick(page, PICKER.theme, THEMES.indexOf(shot.theme))
      const view = shot.view ?? 'city'
      if (view !== currentView) {
        await page.keyboard.press('v')
        await page.waitForTimeout(1600) // the scene is rebuilt from scratch
        currentView = view
      }
      if (shot.color) await pick(page, PICKER.color, COLORS.indexOf(shot.color))

      for (const key of shot.keys ?? []) {
        await page.keyboard.press(key)
        await page.waitForTimeout(250)
      }
      if (shot.setup) await shot.setup(page)
      await page.waitForTimeout(shot.hold ?? 900)

      const ext = shot.png ? 'png' : 'jpg'
      const path = join(stage, `${shot.name}.${ext}`)
      await page.screenshot({
        path,
        scale: 'css',
        ...(shot.png ? {} : { type: 'jpeg', quality: QUALITY })
      })
      console.log(`  ✓ ${shot.name}.${ext}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${shot.name}: ${err.message}`)
    }
  }
} finally {
  await app.close()
}

for (const f of readdirSync(stage)) copyFileSync(join(stage, f), join(outDir, f))
rmSync(stage, { recursive: true, force: true })

if (failed) {
  console.error(`\n${failed} shot(s) failed`)
  process.exit(1)
}
console.log(`\n${shots.length} shot(s) → ${outDir}`)
