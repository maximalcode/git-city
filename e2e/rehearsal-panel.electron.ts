import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('nonmodal rehearsal panel keeps the city usable and explains retained states', async () => {
  test.setTimeout(360_000)
  const tool = process.env.GIT_CITY_REHEARSE_BIN
  expect(tool, 'Set GIT_CITY_REHEARSE_BIN to a compatible real executable').toBeTruthy()
  const container = await mkdtemp(join(tmpdir(), 'git-city-panel-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-city-panel-profile-'))
  const repo = join(container, 'long-worktree-name-'.repeat(8))
  await mkdir(repo, { recursive: true })
  const longBranch = `topic/${'very-long-label-'.repeat(7)}end`
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  let app: ElectronApplication | undefined

  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    await writeFile(join(repo, 'base.txt'), 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', longBranch)
    await writeFile(join(repo, 'topic.txt'), 'topic\n')
    git('add', '.')
    git('commit', '-m', 'topic')
    git('checkout', 'main')

    app = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: tool!
      }
    })
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, repo)
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(900, 680)
    )
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    await page.getByRole('button', { name: 'Rehearse (internal)' }).click()

    const panel = page.getByRole('complementary', { name: 'Rehearse merge', exact: true })
    await expect(panel).toBeVisible()
    await expect(page.locator('.modal-backdrop')).toHaveCount(0)
    await expect(panel).not.toHaveAttribute('aria-modal')
    const layout = await panel.evaluate((element) => {
      const panelBox = element.getBoundingClientRect()
      const workspace = document.querySelector('.app-workspace')?.getBoundingClientRect()
      return {
        panelLeft: panelBox.left,
        panelRight: panelBox.right,
        viewportWidth: window.innerWidth,
        workspaceWidth: workspace?.width ?? 0
      }
    })
    expect(layout.panelLeft).toBeGreaterThan(0)
    expect(layout.panelRight).toBeCloseTo(layout.viewportWidth, 0)
    expect(layout.workspaceWidth).toBeLessThan(layout.viewportWidth)

    // The panel is an adjacent workspace: keyboard focus can return to city controls.
    const branches = page.getByRole('button', { name: 'Branches', exact: true })
    await branches.focus()
    await expect(branches).toBeFocused()
    await expect(panel).toBeVisible()
    await branches.click()
    await page
      .locator('.branch-row')
      .filter({ hasText: longBranch })
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    const cityConfirmation = page.getByRole('alertdialog')
    await expect(cityConfirmation).toBeVisible()
    // The app's destructive confirmation must stack above the adjacent panel.
    await cityConfirmation
      .getByRole('button', { name: 'Delete', exact: true })
      .click({ trial: true })
    await cityConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(cityConfirmation).not.toBeVisible()
    await expect(panel).toBeVisible()
    await page
      .locator('.branches-panel')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await expandRehearsal(page, /^Choose rehearsal target$/)
    const target = page.getByLabel('Branch or commit to merge into the current checkout')
    await target.fill(longBranch)
    await expect(panel.locator('.rehearsal-direction dd').last()).toContainText(longBranch)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()

    const footer = panel.locator('.rehearsal-footer')
    await expect(footer).toContainText('Hooks were not run')
    await expect(panel.locator('.rehearsal-direction dd').last()).toContainText(longBranch)
    await expandRehearsal(page, /^Technical details$/)
    await expect(panel).toContainText(repo)
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true
    )

    // A clean, eligible result opens an actual modal confirmation while the panel remains mounted.
    const apply = page.getByRole('button', { name: 'Apply', exact: true })
    await expect(apply).toBeEnabled()
    await apply.click()
    const confirmation = page.getByRole('dialog', { name: 'Confirm Apply', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText(longBranch)
    await page.keyboard.press('Escape')
    await expect(confirmation).not.toBeVisible()
    await expect(apply).toBeFocused()

    // Moving the real checkout makes the retained report stale; the UI keeps it inspectable.
    // Advance the real ref without racing the app's status reader for index.lock.
    const advanced = git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'advance checkout basis')
    git('update-ref', 'HEAD', advanced)
    await expandRehearsal(page, /^Saved rehearsals/)
    await panel.getByRole('button', { name: 'Refresh history', exact: true }).click()
    await expect(
      panel.getByRole('alert').filter({ hasText: 'outdated checkout or ref basis' })
    ).toBeVisible()
    await expect(apply).toBeEnabled()

    // A retained failed result uses the same report view, with an explicit disabled footer.
    await expandRehearsal(page, /^Rehearse again$/)
    const missingTarget = 'missing-merge-target-for-panel-test'
    await target.fill(missingTarget)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Git could not complete the merge' })
    ).toBeVisible()
    await expect(apply).toBeDisabled()
    await expect(footer).toContainText('Apply requires a completed, conflict-free result.')
    await expect(panel.getByRole('alert').filter({ hasText: missingTarget })).toBeVisible()
  } finally {
    await app?.close()
    if (tool) {
      try {
        const listing = JSON.parse(
          execFileSync(tool, ['--json', 'list'], { cwd: repo, encoding: 'utf8' })
        )
        for (const entry of listing.rehearsals)
          execFileSync(tool, ['--json', 'discard', entry.id], { cwd: repo })
      } catch {
        /* The test may fail before the repository is ready for CLI inspection. */
      }
    }
    await rm(container, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
