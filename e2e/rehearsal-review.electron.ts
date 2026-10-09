import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { expandRehearsal } from './rehearsal-ui'

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
  await writeFile(join(repo, '.gitattributes'), '*.txt binary\n')
  await writeFile(join(repo, 'same.txt'), 'before\n')
  await writeFile(join(repo, 'deleted.txt'), 'kept before\n')
  await writeFile(join(repo, 'carried.txt'), 'carried before\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'same.txt'), 'after\n')
  await writeFile(join(repo, 'added.txt'), 'new file\n')
  await rm(join(repo, 'deleted.txt'))
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
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page
      .getByText('Reduce motion', { exact: true })
      .locator('..')
      .getByRole('checkbox')
      .check()
    await page.getByRole('button', { name: 'Close' }).click()
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
    await expect(review.getByText('3 changed files', { exact: true })).toBeVisible()
    const same = review.getByRole('option').filter({ hasText: 'same.txt' })
    await expect(same).toContainText('Modified')
    await expect(review.getByRole('option').filter({ hasText: 'added.txt' })).toContainText('Added')
    await expect(review.getByRole('option').filter({ hasText: 'deleted.txt' })).toContainText(
      'Deleted'
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
        deletedAfter: await read('deleted.txt', 'after')
      }
    }, identity)
    expect(bridgeReview.summary.scopes.map((scope) => scope.scopeId)).toContain('tracked-worktree')
    expect(bridgeReview.summary.carried?.included).toBe(true)
    expect(bridgeReview.files.complete).toBe(true)
    expect(bridgeReview.files.total).toBe(3)
    expect(bridgeReview.addedBefore).toMatchObject({ availability: 'absent', text: null })
    expect(bridgeReview.addedAfter).toMatchObject({ availability: 'available', text: 'new file\n' })
    expect(bridgeReview.deletedBefore).toMatchObject({
      availability: 'available',
      text: 'kept before\n'
    })
    expect(bridgeReview.deletedAfter).toMatchObject({ availability: 'absent', text: null })

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
    await city.getByRole('button', { name: 'Compare city', exact: true }).click()
    await expect(city.getByRole('button', { name: 'Before', exact: true })).toBeVisible()
    await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
    await expect(city.getByLabel('Review change markers')).toContainText('Modified')
    await expect(city.getByLabel('Review change markers')).toContainText('Added')
    await expect(city.getByLabel('Review change markers')).toContainText('Deleted')
    await added.click()
    await city.getByRole('button', { name: 'Before', exact: true }).click()
    await expect(city.getByText(/absent from the Before endpoint/)).toBeVisible()
    await city.getByRole('button', { name: 'After', exact: true }).click()
    await expect(city.getByText(/absent from the Before endpoint/)).toHaveCount(0)
    await page.screenshot({ path: 'test-results/rehearsal-review-city-960x700.png' })

    const deleted = review.getByRole('option').filter({ hasText: 'deleted.txt' })
    await deleted.click()
    await review.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('kept before\n')
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveCount(0)
    await expect(review.getByText('This side is absent.', { exact: true })).toBeVisible()

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
      for (const item of inventory.rehearsals)
        execFileSync(tool, ['--json', 'discard', item.id], { cwd: repo })
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
