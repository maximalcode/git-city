import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('retained history survives an Electron restart and keyboard discard/stop preserve other work', async () => {
  test.setTimeout(600_000)
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const root = await mkdtemp(join(tmpdir(), 'git-city-history-e2e-'))
  const repo = join(root, 'repo')
  const env = {
    ...process.env,
    GIT_CITY_REHEARSE_BIN: tool,
    GIT_REHEARSE_CACHE_DIR: join(root, 'cache'),
    ELECTRON_RENDERER_URL: 'http://localhost:5199'
  }
  execFileSync('git', ['init', '-b', 'main', repo])
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(repo, 'file.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(repo, 'file.txt'), 'topic\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  const before = {
    head: git('rev-parse', 'HEAD'),
    index: await readFile(join(repo, '.git/index')),
    file: await readFile(join(repo, 'file.txt'))
  }
  let app: ElectronApplication | undefined
  const launch = async (): Promise<ElectronApplication> => {
    const launched = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'user-data')}`],
      env
    })
    await launched.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, repo)
    const page = await launched.firstWindow()
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Rehearse (internal)' }).click()
    return launched
  }
  try {
    app = await launch()
    let page = await app.firstWindow()
    const create = async (): Promise<void> => {
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await page.getByRole('button', { name: 'Rehearse', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
      await expect(page.locator('.rehearsal-panel [aria-busy]')).toHaveAttribute(
        'aria-busy',
        'false'
      )
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeEnabled()
    }
    await create()
    await create()
    const inventory = await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)
    expect(inventory.entries).toHaveLength(2)
    const [second, first] = inventory.entries
    await expandRehearsal(page, /^Saved rehearsals/)
    await page.getByRole('button', { name: `Open ${first.id}`, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: `Open ${first.id} (current)`, exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('button', { name: `Open ${first.id} (current)`, exact: true })
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Rehearse (internal)' })).toBeFocused()
    await app.close()
    app = undefined
    // A real main/renderer process restart, with the same browser preference storage.
    app = await launch()
    page = await app.firstWindow()
    await expandRehearsal(page, /^Saved rehearsals/)
    await expect(
      page.getByRole('button', { name: `Open ${first.id} (current)`, exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/Retained logical size:/)).toBeVisible()
    const check = page.getByRole('checkbox', { name: `Select ${second.id} for discard` })
    await expect(check).toBeEnabled()
    await check.focus()
    await page.keyboard.press('Space')
    await expect(check).toBeChecked()
    const discard = page.getByRole('button', { name: 'Discard selected (1)', exact: true })
    await discard.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Cancel Discard' })).toBeFocused()
    await expect(page.getByRole('dialog', { name: 'Confirm Discard', exact: true })).toContainText(
      second.id
    )
    await expect(page.getByRole('dialog', { name: 'Confirm Discard', exact: true })).toContainText(
      second.origin_worktree
    )
    await page.keyboard.press('Escape')
    await expect(discard).toBeFocused()
    expect(
      (await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)).entries
    ).toHaveLength(2)
    // Background report refreshes can restore focus while the IPC read awaits.
    await discard.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'Discard rehearsals', exact: true })
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('heading', { name: 'Retained rehearsals', exact: true })
    ).toBeFocused()
    expect(
      (await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)).entries.map(
        (entry) => entry.id
      )
    ).toEqual([first.id])
    // CLI-created retained work is also discovered, and batch discard is exact.
    for (let i = 0; i < 2; i++)
      execFileSync(tool, ['--json', '--keep', 'merge', 'topic'], { cwd: repo, env })
    await expandRehearsal(page, /^Saved rehearsals/)
    await page.getByRole('button', { name: 'Refresh history' }).click()
    const many = await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)
    for (const entry of many.entries.filter((entry) => entry.id !== first.id)) {
      const box = page.getByRole('checkbox', { name: `Select ${entry.id} for discard` })
      await expect(box).toBeEnabled()
      await box.focus()
      await page.keyboard.press('Space')
      await expect(box).toBeChecked()
    }
    await page.getByRole('button', { name: 'Discard selected (2)', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('heading', { name: 'Retained rehearsals', exact: true })
    ).toBeFocused()
    expect(
      (await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)).entries.map(
        (entry) => entry.id
      )
    ).toEqual([first.id])
    expect(git('rev-parse', 'HEAD')).toBe(before.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
    expect(await readFile(join(repo, 'file.txt'))).toEqual(before.file)
    // Start an actual slow merge driver, close/reopen while running, then Stop.
    await writeFile(join(repo, 'file.txt'), 'main\n')
    await writeFile(join(repo, '.gitattributes'), 'file.txt merge=wait\n')
    git('add', '.')
    git('commit', '-m', 'diverge')
    await page.getByRole('button', { name: 'Refresh history' }).click()
    await expect(page.getByText(/This rehearsal has an outdated/)).toBeVisible()
    await page.screenshot({ path: 'test-results/rehearsal-stale.png' })
    const driver = join(root, 'driver.sh')
    const sentinel = join(root, 'started')
    await writeFile(driver, `#!/bin/sh\ntouch '${sentinel}'\nsleep 60\nexit 1\n`)
    await chmod(driver, 0o700)
    git('config', 'merge.wait.driver', driver)
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect.poll(async () => readFile(sentinel, 'utf8').catch(() => null)).toBe('')
    await page.screenshot({ path: 'test-results/rehearsal-running.png' })
    await page.getByRole('button', { name: 'Keep and close', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Rehearse (internal)' })).toBeFocused()
    await page.getByRole('button', { name: 'Rehearse (internal)' }).click()
    await page.getByRole('button', { name: 'Stop rehearsal', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: 'Stop rehearsal', exact: true })
    ).not.toBeVisible()
    await expect(page.getByText(/Execution ended. Retained state/)).toBeVisible()
    await expect(page.locator('.rehearsal-panel [aria-live="polite"]')).toBeFocused()
    await expandRehearsal(page, /^Saved rehearsals/)
    await page.getByRole('button', { name: 'Refresh history' }).click()
    const stopped = (
      await page.evaluate((repo) => window.gitCity.rehearsalList(repo), repo)
    ).entries.find((entry) => entry.id !== first.id)!
    expect(stopped.active).toBe(false)
    expect(stopped.execution).toBe('incomplete')
    await page.getByRole('button', { name: `Open ${stopped.id}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Merge execution is incomplete' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    await expect(page.getByText(/This rehearsal has an outdated/)).not.toBeVisible()
    await page.screenshot({ path: 'test-results/rehearsal-management.png' })
  } finally {
    if (app) {
      await (
        await app.firstWindow()
      )
        .evaluate((repo) => window.gitCity.rehearsalStop(repo), repo)
        .catch(() => undefined)
      await app.close()
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  }
})
