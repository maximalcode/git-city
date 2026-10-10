import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('keyboard city comparison stays with its frozen rehearsal when switching results', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const userData = await mkdtemp(join(tmpdir(), 'city-compare-user-'))
  const repo = await mkdtemp(join(tmpdir(), 'city-compare-app-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(repo, 'file.txt'), 'line\n'.repeat(100))
  await writeFile(join(repo, 'context.ts'), 'context\n'.repeat(60))
  await writeFile(join(repo, 'README.md'), 'docs\n'.repeat(30))
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'file.txt'), 'line\n'.repeat(200))
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  const before = { head: git('rev-parse', 'HEAD'), index: await readFile(join(repo, '.git/index')) }
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5199',
      GIT_CITY_REHEARSE_BIN: tool
    }
  })
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, repo)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page
      .locator('label.settings-row.toggle')
      .filter({ hasText: 'Reduce motion' })
      .getByRole('checkbox')
      .check({ force: true })
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    const create = async (target: string): Promise<void> => {
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await page.getByLabel('Branch or commit to merge into the current checkout').fill(target)
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
      await expect(page.locator('.rehearsal-panel [aria-busy]')).toHaveAttribute(
        'aria-busy',
        'false'
      )
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeEnabled()
    }
    await create('topic')
    await page.waitForFunction(
      () => !!(window as unknown as { __gitCityCam?: unknown }).__gitCityCam
    )
    const liveCameraBefore = await page.evaluate(() => {
      const camera = (
        window as unknown as {
          __gitCityCam?: { position: { x: number; y: number; z: number } }
        }
      ).__gitCityCam!
      return [camera.position.x, camera.position.y, camera.position.z]
    })
    await page.getByRole('button', { name: 'Show city context', exact: true }).click()
    const comparison = page.getByRole('region', { name: 'Rehearsal city comparison' })
    await expect(comparison).toBeVisible()
    await expect(
      comparison.getByRole('button', { name: 'Compare city', exact: true })
    ).toBeVisible()
    const compare = async (): Promise<void> => {
      await expect(
        comparison.getByRole('button', { name: 'Compare city', exact: true })
      ).toBeVisible()
      await comparison.getByRole('button', { name: 'Compare city', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(comparison.getByRole('button', { name: 'Before', exact: true })).toBeFocused()
      await comparison.getByText('Snapshot files and line counts', { exact: true }).click()
    }
    await compare()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
    await expect(comparison.getByText('file.txt: 100 lines', { exact: true })).toBeVisible()
    await comparison.getByRole('button', { name: 'Before', exact: true }).focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(comparison.getByRole('button', { name: 'After', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(comparison.getByText('file.txt: 200 lines', { exact: true })).toBeVisible()
    await create('main')
    await expect(comparison.getByRole('button', { name: 'After', exact: true })).not.toBeVisible()
    await compare()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
    await comparison.getByRole('button', { name: 'After', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(comparison.getByText('file.txt: 100 lines', { exact: true })).toBeVisible()
    const inventory = await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)
    await expandRehearsal(page, /^Saved rehearsals/)
    const first = inventory.entries.find((entry) => entry.command[1] === 'topic')!
    await page.getByRole('button', { name: `Open ${first.id}`, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(
      comparison.getByRole('button', { name: 'Compare city', exact: true })
    ).toBeEnabled()
    await compare()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
    await expect(comparison.getByRole('status')).toContainText(first.id)
    await comparison.getByRole('button', { name: 'After', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(comparison.getByText('file.txt: 200 lines', { exact: true })).toBeVisible()
    // Let the existing scene's height/color interpolation settle for visual QA.
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'test-results/rehearsal-comparison.png' })
    await comparison.getByRole('button', { name: 'Return to live city', exact: true }).click()
    await expect(
      comparison.getByRole('button', { name: 'Compare city', exact: true })
    ).toBeFocused()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
    await page.waitForFunction(() => {
      const scene = window as unknown as {
        __gitCitySceneCanvas?: HTMLCanvasElement
        __gitCityCam?: unknown
      }
      return (
        scene.__gitCitySceneCanvas?.isConnected &&
        !scene.__gitCitySceneCanvas.closest('.rehearsal-city') &&
        !!scene.__gitCityCam
      )
    })
    const liveCameraAfter = await page.evaluate(() => {
      const camera = (
        window as unknown as {
          __gitCityCam?: { position: { x: number; y: number; z: number } }
        }
      ).__gitCityCam!
      return [camera.position.x, camera.position.y, camera.position.z]
    })
    expect(
      Math.max(...liveCameraBefore.map((value, index) => Math.abs(value - liveCameraAfter[index])))
    ).toBeLessThan(0.01)
    expect(git('rev-parse', 'HEAD')).toBe(before.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Rehearse panel' })).toBeFocused()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
  } finally {
    await app.close()
    try {
      const inventory = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: repo, encoding: 'utf8' })
      )
      for (const entry of inventory.rehearsals)
        execFileSync(tool, ['--json', 'discard', entry.id], { cwd: repo })
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  }
})
