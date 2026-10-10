import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { expandRehearsal } from './rehearsal-ui'
import type { InstancedMesh, PerspectiveCamera, Scene } from 'three'

test('reviews immutable Changes, Before and After content for same-line, added and deleted files', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const userData = await mkdtemp(join(tmpdir(), 'city-review-user-'))
  const repo = await mkdtemp(join(tmpdir(), 'city-review-app-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  // The review must classify retained bytes itself; mutable attributes must not
  // turn valid UTF-8 content into an unavailable or filtered response.
  await writeFile(join(repo, '.gitattributes'), 'same.txt binary\n')
  await writeFile(join(repo, 'same.txt'), 'before\n')
  await writeFile(join(repo, 'deleted.txt'), 'kept before\n')
  await writeFile(
    join(repo, 'old-name.txt'),
    'rename before\nkeep\nstable\none\ntwo\nthree\nfour\nfive\n'
  )
  await writeFile(join(repo, 'carried.txt'), 'carried before\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'same.txt'), 'after\n')
  await writeFile(join(repo, 'added.txt'), 'new file\n')
  git('mv', 'old-name.txt', 'new-name.txt')
  await writeFile(
    join(repo, 'new-name.txt'),
    'rename after\nkeep\nstable\none\ntwo\nthree\nfour\nfive\n'
  )
  await rm(join(repo, 'deleted.txt'))
  for (let index = 0; index < 32; index++) {
    await writeFile(join(repo, `extra-${String(index).padStart(2, '0')}.txt`), `extra ${index}\n`)
  }
  git('add', '-A')
  git('commit', '-m', 'review changes')
  git('checkout', 'main')
  await writeFile(join(repo, 'carried.txt'), 'carried live edit\n')
  const beforeHead = git('rev-parse', 'HEAD')
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
    await page.setViewportSize({ width: 960, height: 700 })
    await expect(page.getByRole('button', { name: 'Open a local repository…' })).toBeVisible({
      timeout: 90_000
    })
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page
      .locator('label.settings-row.toggle')
      .filter({ hasText: 'Reduce motion' })
      .getByRole('checkbox')
      .check({ force: true })
    await page.getByRole('button', { name: 'Close' }).click()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByLabel('Command palette', { exact: true }).fill('carried.txt')
    await page.getByLabel('Command palette', { exact: true }).press('Enter')
    await expect(page.locator('.details .path')).toHaveText('carried.txt')
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(page.locator('.rehearsal-panel [aria-busy]')).toHaveAttribute('aria-busy', 'false')

    const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
    const resizeHandle = review.getByRole('separator', { name: 'Resize file list' })
    await expect(resizeHandle).toBeVisible()
    const initialInventoryWidth = Number(await resizeHandle.getAttribute('aria-valuenow'))
    await resizeHandle.focus()
    await resizeHandle.press('ArrowRight')
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', String(initialInventoryWidth + 2))
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await expect(review.getByText(/changed files$/, { exact: false })).toBeVisible()
    const fileList = review.locator('.rehearsal-review-files')
    expect(await fileList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true
    )
    const lastFile = review.getByRole('option').filter({ hasText: 'extra-31.txt' })
    await expect(lastFile).toHaveCount(1)
    await lastFile.scrollIntoViewIfNeeded()
    await expect(lastFile).toBeVisible()
    await expect(lastFile).toBeEnabled()
    await lastFile.click()
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('extra 31\n')
    const same = review.getByRole('option').filter({ hasText: 'same.txt' })
    await expect(same).toContainText('Modified')
    await expect(review.getByRole('option').filter({ hasText: 'added.txt' })).toContainText('Added')
    await expect(review.getByRole('option').filter({ hasText: 'deleted.txt' })).toContainText(
      'Deleted'
    )
    await expect(review.getByRole('option').filter({ hasText: 'old-name.txt' })).toContainText(
      'Renamed'
    )

    const selected = await page.evaluate((path) => window.gitCity.rehearsalList(path), repo)
    const identity = selected.entries.find((item) => item.command.at(-1) === 'topic')!
    const bridgeReview = await page.evaluate(async (reviewIdentity) => {
      const summary = await window.gitCity.rehearsalReviewSummary(reviewIdentity)
      const files = await window.gitCity.rehearsalReviewFiles(
        reviewIdentity,
        summary.reviewRevision,
        summary.defaultScopeId!
      )
      const read = async (name: string, view: 'before' | 'after') => {
        const entry = files.entries.find(
          (candidate) => candidate.newPath === name || candidate.oldPath === name
        )!
        return window.gitCity.rehearsalReviewFile(
          reviewIdentity,
          summary.reviewRevision,
          summary.defaultScopeId!,
          entry.entryId,
          view
        )
      }
      return {
        summary,
        files,
        addedBefore: await read('added.txt', 'before'),
        addedAfter: await read('added.txt', 'after'),
        deletedBefore: await read('deleted.txt', 'before'),
        deletedAfter: await read('deleted.txt', 'after'),
        renamedBefore: await read('new-name.txt', 'before'),
        renamedAfter: await read('new-name.txt', 'after')
      }
    }, identity)
    expect(bridgeReview.summary.scopes.map((scope) => scope.scopeId)).toContain('tracked-worktree')
    expect(bridgeReview.summary.carried?.included).toBe(true)
    expect(bridgeReview.files.complete).toBe(true)
    expect(bridgeReview.files.total).toBe(36)
    expect(bridgeReview.addedBefore).toMatchObject({ availability: 'absent', text: null })
    expect(bridgeReview.addedAfter).toMatchObject({ availability: 'available', text: 'new file\n' })
    expect(bridgeReview.deletedBefore).toMatchObject({
      availability: 'available',
      text: 'kept before\n'
    })
    expect(bridgeReview.deletedAfter).toMatchObject({ availability: 'absent', text: null })
    expect(bridgeReview.renamedBefore).toMatchObject({
      availability: 'available',
      text: 'rename before\nkeep\nstable\none\ntwo\nthree\nfour\nfive\n'
    })
    expect(bridgeReview.renamedAfter).toMatchObject({
      availability: 'available',
      text: 'rename after\nkeep\nstable\none\ntwo\nthree\nfour\nfive\n'
    })

    await same.click()
    await expect(review.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(review.locator('.diff-del')).toContainText('before')
    await expect(review.locator('.diff-add')).toContainText('after')
    await review.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('before\n')
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('after\n')

    const added = review.getByRole('option').filter({ hasText: 'added.txt' })
    await added.click()
    await review.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(review.locator('pre')).toHaveCount(0)
    await expect(review.getByText('This side is absent.', { exact: true })).toBeVisible()
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('new file\n')

    // R6: the optional city is the same review context. Its status markers are
    // textual and shape/color differentiated in the scene, while endpoint
    // absence remains explicit in the selected file review.
    await review.getByRole('button', { name: 'Show city context', exact: true }).click()
    const city = review.getByRole('region', { name: 'Rehearsal city comparison' })
    await expect(city.getByRole('button', { name: 'Compare city', exact: true })).toBeVisible()
    const liveCamera = await page.evaluate(() =>
      (window as unknown as { __gitCityCam: PerspectiveCamera }).__gitCityCam.position.toArray()
    )
    await city.getByRole('button', { name: 'Compare city', exact: true }).click()
    await expect(page.locator('.details')).toHaveCount(0)
    await expect(city.getByRole('button', { name: 'Before', exact: true })).toBeVisible()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
    await expect(city.getByLabel('Review change markers')).toContainText('Modified')
    await expect(city.getByLabel('Review change markers')).not.toContainText('Added')
    await expect(city.getByLabel('Review change markers')).toContainText('Deleted')
    await expect(city.getByLabel('Review change markers')).toContainText('Renamed')
    // Wait for the actual comparison surface, not a stale probe from the live
    // canvas which has just unmounted. Selection below still uses a real click.
    await page.waitForFunction(() => {
      const probe = window as unknown as { __gitCitySceneCanvas?: HTMLCanvasElement }
      return probe.__gitCitySceneCanvas === document.querySelector('.rehearsal-city canvas')
    })
    const projectBuilding = () =>
      page.evaluate(() => {
        const probe = window as unknown as {
          __gitCityScene?: Scene
          __gitCityCam?: PerspectiveCamera
          __gitCitySceneCanvas?: HTMLCanvasElement
        }
        const mesh = probe.__gitCityScene?.getObjectByName('file-buildings') as
          InstancedMesh | undefined
        const camera = probe.__gitCityCam
        const canvas = probe.__gitCitySceneCanvas
        if (!mesh?.isInstancedMesh || !camera || !canvas)
          throw new Error('Comparison scene missing')
        const index = (mesh.userData.filePaths as string[]).indexOf('same.txt')
        if (index < 0) throw new Error('same.txt has no rendered building')
        const offset = index * 16
        const elements = mesh.instanceMatrix.array
        const scaleY = Math.hypot(elements[offset + 1], elements[offset + 5], elements[offset + 9])
        const point = camera.position
          .clone()
          .set(elements[offset + 12], elements[offset + 13] + scaleY * 0.45, elements[offset + 14])
        point.applyMatrix4(mesh.matrixWorld).project(camera)
        const rect = canvas.getBoundingClientRect()
        return {
          x: rect.left + ((point.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - point.y) / 2) * rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        }
      })
    const buildingPoint = await projectBuilding()
    expect(buildingPoint.x).toBeGreaterThan(buildingPoint.left)
    expect(buildingPoint.x).toBeLessThan(buildingPoint.right)
    expect(buildingPoint.y).toBeGreaterThan(buildingPoint.top)
    expect(buildingPoint.y).toBeLessThan(buildingPoint.bottom)
    // The DOM selection commits before R3F applies its camera update. Observe
    // from before the real click, then measure from the first actual movement:
    // reduced motion permits one direct jump, never a sequence of tween steps.
    const [focusMotion] = await Promise.all([
      page.evaluate(async () => {
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const camera = (window as unknown as { __gitCityCam: PerspectiveCamera }).__gitCityCam
        const origin = camera.position.clone()
        const deadline = performance.now() + 90_000
        while (origin.distanceTo(camera.position) < 0.01) {
          await frame()
          if (performance.now() > deadline) throw new Error('Selected review camera never focused')
        }
        const first = camera.position.clone()
        let maximum = 0
        for (let index = 0; index < 8; index++) {
          await frame()
          maximum = Math.max(maximum, first.distanceTo(camera.position))
        }
        return maximum
      }),
      (async () => {
        await page.mouse.click(buildingPoint.x, buildingPoint.y)
        await expect(same).toHaveAttribute('aria-selected', 'true')
      })()
    ])
    expect(focusMotion, 'Reduce motion must not animate the selected review focus').toBeLessThan(
      0.01
    )
    const focusedPoint = await projectBuilding()
    await page.mouse.dblclick(focusedPoint.x, focusedPoint.y)
    await expect(same).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.diff-panel')).toHaveCount(0)

    await expect(review.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(review.locator('.diff-del')).toContainText('before')
    await expect(review.locator('.diff-add')).toContainText('after')
    await added.click()
    await city.getByRole('button', { name: 'Before', exact: true }).click()
    await expect(city.getByText(/absent from the Before endpoint/)).toBeVisible()
    await city.getByRole('button', { name: 'After', exact: true }).click()
    await expect(city.getByText(/absent from the Before endpoint/)).toHaveCount(0)
    await expect(city.getByLabel('Review change markers')).toContainText('Added')
    await expect(city.getByLabel('Review change markers')).not.toContainText('Deleted')
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      BrowserWindow.getAllWindows()[0]?.focus()
    })
    await page.screenshot({
      path: 'test-results/rehearsal-review-city-960x700.png',
      timeout: 90_000
    })

    const renamed = review.getByRole('option').filter({ hasText: 'old-name.txt' })
    await renamed.click()
    await review.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(review.locator('pre')).toHaveText(
      'rename before\nkeep\nstable\none\ntwo\nthree\nfour\nfive\n'
    )
    await city.getByRole('button', { name: 'Before', exact: true }).click()
    await expect(city.getByText(/absent from the/)).toHaveCount(0)
    await city.getByRole('button', { name: 'After', exact: true }).click()
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveText(
      'rename after\nkeep\nstable\none\ntwo\nthree\nfour\nfive\n'
    )
    await expect(city.getByText(/absent from the/)).toHaveCount(0)

    const deleted = review.getByRole('option').filter({ hasText: 'deleted.txt' })
    await deleted.click()
    await review.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('kept before\n')
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveCount(0)
    await expect(review.getByText('This side is absent.', { exact: true })).toBeVisible()

    await city.getByRole('button', { name: 'Return to live city', exact: true }).click()
    await expect(page.locator('.details .path')).toHaveText('carried.txt')
    await page.waitForFunction(() => {
      const canvas = (window as unknown as { __gitCitySceneCanvas?: HTMLCanvasElement })
        .__gitCitySceneCanvas
      return canvas?.isConnected && !canvas.closest('.rehearsal-city')
    })
    const restoredCamera = await page.evaluate(() =>
      (window as unknown as { __gitCityCam: PerspectiveCamera }).__gitCityCam.position.toArray()
    )
    for (let axis = 0; axis < 3; axis++)
      expect(restoredCamera[axis]).toBeCloseTo(liveCamera[axis], 4)
    const entry = identity
    const shown = await page.evaluate(
      async ({ path, id }) => {
        const list = await window.gitCity.rehearsalList(path)
        const exact = list.entries.find((item) => item.id === id)!
        return window.gitCity.rehearsalShow(exact)
      },
      { path: repo, id: entry.id }
    )
    expect(shown.kind).toBe('report')
    if (shown.kind !== 'report' || !shown.report.sandbox) throw new Error('missing retained report')
    await writeFile(join(repo, 'same.txt'), 'live checkout edit\n')
    await writeFile(join(shown.report.sandbox, 'same.txt'), 'sandbox edit\n')
    await page.getByRole('button', { name: 'Close rehearsal panel' }).click()
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    const reopened = page.getByRole('region', { name: 'Frozen rehearsal review' })
    await reopened.getByRole('option').filter({ hasText: 'same.txt' }).click()
    await reopened.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(reopened.locator('pre')).toHaveText('before\n')
    await reopened.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(reopened.locator('pre')).toHaveText('after\n')
    await page.screenshot({ path: 'test-results/rehearsal-review-960x700.png' })
    await page.screenshot({ path: 'test-results/rehearsal-review.png' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(review).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({ path: 'test-results/rehearsal-review-1280x800.png' })
    expect(git('rev-parse', 'HEAD')).toBe(beforeHead)
    expect(await readFile(join(repo, 'same.txt'), 'utf8')).toBe('live checkout edit\n')
  } finally {
    await app.close()
    try {
      const inventory = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: repo, encoding: 'utf8' })
      )
      for (const item of inventory.rehearsals) {
        try {
          execFileSync(tool, ['--json', 'discard', item.id], { cwd: repo })
        } catch {
          // The pinned tool may finish its final cleanup just after Electron
          // exits; this isolated temporary repository can then be removed.
        }
      }
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  }
})

test('exposes separate real rebase reference scopes through the public bridge', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const userData = await mkdtemp(join(tmpdir(), 'city-review-scopes-user-'))
  const repo = await mkdtemp(join(tmpdir(), 'city-review-scopes-app-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(repo, 'base.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'topic.txt'), 'topic\n')
  git('add', '.')
  git('commit', '-m', 'topic')
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
    const result = await page.evaluate(
      ({ path, target }) => window.gitCity.rehearse(path, 'rebase', target),
      { path: repo, target: 'topic' }
    )
    expect(result.kind).toBe('report')
    if (result.kind !== 'report') throw new Error(result.message)
    const summary = await page.evaluate(
      (identity) => window.gitCity.rehearsalReviewSummary(identity),
      result.report
    )
    const committed = summary.scopes.filter((scope) => scope.kind === 'committed-reference')
    expect(committed.length).toBeGreaterThan(0)
    expect(committed.some((scope) => scope.refAliases.includes('HEAD'))).toBe(true)
    expect(committed.some((scope) => scope.refAliases.includes('refs/heads/main'))).toBe(true)
    expect(git('rev-parse', 'HEAD')).toBe(before.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
    await page.screenshot({ path: 'test-results/rehearsal-review-scopes.png' })
  } finally {
    await app.close()
    try {
      const inventory = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: repo, encoding: 'utf8' })
      )
      for (const item of inventory.rehearsals)
        execFileSync(tool, ['--json', 'discard', item.id], { cwd: repo })
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  }
})
