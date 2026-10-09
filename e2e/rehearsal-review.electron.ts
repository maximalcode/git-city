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
  await writeFile(join(repo, 'same.txt'), 'before\n')
  await writeFile(join(repo, 'deleted.txt'), 'kept before\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'same.txt'), 'after\n')
  await writeFile(join(repo, 'added.txt'), 'new file\n')
  await rm(join(repo, 'deleted.txt'))
  git('add', '-A')
  git('commit', '-m', 'review changes')
  git('checkout', 'main')
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
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(page.locator('.rehearsal-panel [aria-busy]')).toHaveAttribute('aria-busy', 'false')

    const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
    await review.getByRole('button', { name: 'Review changed files', exact: true }).click()
    await expect(review.getByText('3 changed files', { exact: true })).toBeVisible()
    const same = review.getByRole('option').filter({ hasText: 'same.txt' })
    await expect(same).toContainText('Modified')
    await expect(review.getByRole('option').filter({ hasText: 'added.txt' })).toContainText('Added')
    await expect(review.getByRole('option').filter({ hasText: 'deleted.txt' })).toContainText(
      'Deleted'
    )

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

    const deleted = review.getByRole('option').filter({ hasText: 'deleted.txt' })
    await deleted.click()
    await review.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(review.locator('pre')).toHaveText('kept before\n')
    await review.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(review.locator('pre')).toHaveCount(0)
    await expect(review.getByText('This side is absent.', { exact: true })).toBeVisible()

    const selected = await page.evaluate((path) => window.gitCity.rehearsalList(path), repo)
    const entry = selected.entries.find((item) => item.command.at(-1) === 'topic')!
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
    await reopened.getByRole('button', { name: 'Review changed files', exact: true }).click()
    await reopened.getByRole('option').filter({ hasText: 'same.txt' }).click()
    await reopened.getByRole('tab', { name: 'Before', exact: true }).click()
    await expect(reopened.locator('pre')).toHaveText('before\n')
    await reopened.getByRole('tab', { name: 'After', exact: true }).click()
    await expect(reopened.locator('pre')).toHaveText('after\n')
    await page.screenshot({ path: 'test-results/rehearsal-review.png' })
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
