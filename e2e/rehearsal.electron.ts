import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('real Electron merge preview preserves the original and supports keyboard keep/reopen', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN
  expect(tool, 'Set GIT_CITY_REHEARSE_BIN to a compatible real executable').toBeTruthy()
  const userData = await mkdtemp(join(tmpdir(), 'git-city-user-data-'))
  const root = await mkdtemp(join(tmpdir(), 'git-city-electron-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'file.txt'), 'original\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'file.txt'), 'preview\n')
  git('commit', '-am', 'topic')
  const signingKey = join(userData, 'test-key')
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', signingKey], { stdio: 'ignore' })
  git('config', 'gpg.format', 'ssh')
  git('config', 'user.signingKey', signingKey)
  git('config', 'commit.gpgSign', 'true')
  git('commit', '--allow-empty', '-m', 'signed topic')
  git('checkout', 'main')
  git('config', 'merge.ff', 'false')
  git('config', 'user.signingKey', join(userData, 'missing-key'))
  const before = {
    head: git('rev-parse', 'HEAD'),
    index: await readFile(join(root, '.git/index')),
    file: await readFile(join(root, 'file.txt'))
  }
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5199',
      GIT_CITY_REHEARSE_BIN: tool!
    }
  })
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, root)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    const entry = page.getByRole('button', { name: 'Rehearse panel' })
    await entry.focus()
    await page.keyboard.press('Enter')
    const target = page.getByLabel('Branch or commit to merge into the current checkout')
    await expect(target).toBeFocused()
    await target.fill('topic')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Merge stopped' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: /key|sign/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    git('config', 'user.signingKey', signingKey)
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()
    const panel = page.getByRole('complementary', { name: 'Rehearse merge', exact: true })
    await expect(panel).toBeVisible()
    await expect(page.locator(':modal')).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(960, 700)
    )
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('.rehearsal-panel')!.getBoundingClientRect()
      const scene = document.querySelector('.city-root')!.getBoundingClientRect()
      const footer = document.querySelector('.rehearsal-footer')!.getBoundingClientRect()
      return {
        panelLeft: panel.left,
        sceneRight: scene.right,
        footerBottom: footer.bottom,
        height: innerHeight,
        overflow: document.querySelector('.rehearsal-panel')!.scrollWidth > panel.width
      }
    })
    expect(layout.sceneRight).toBeLessThanOrEqual(layout.panelLeft)
    expect(layout.sceneRight).toBeGreaterThan(400)
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.height)
    expect(layout.overflow).toBe(false)
    // Tab leaves the nonmodal panel, and a city toolbar action remains operable.
    await panel.getByRole('button', { name: 'Apply', exact: true }).focus()
    await page.keyboard.press('Tab')
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(false)
    await page.getByRole('button', { name: 'Play history', exact: true }).click()
    await expect(panel).toBeVisible()
    await page.screenshot({ path: 'test-results/rehearsal-narrow.png' })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1360, 900)
    )

    await expandRehearsal(page, /^Technical details$/)
    await expect(page.getByText(/Repository hooks were not run/)).toBeVisible()
    await expandRehearsal(page, /^Review changes$/)
    await expect(page.getByText('M file.txt')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Execution conditions' })).toContainText(
      'not written back'
    )
    await expect(page.getByText(/Signature missing/)).toBeVisible()
    await expect(page.getByText(/Signature present/).first()).toBeVisible()
    await expect(page.getByText(/Verification: not checked/).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(entry).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
    expect(git('rev-parse', 'HEAD')).toBe(before.head)
    expect(await readFile(join(root, '.git/index'))).toEqual(before.index)
    expect(await readFile(join(root, 'file.txt'))).toEqual(before.file)
    await page.screenshot({ path: 'test-results/rehearsal-electron.png' })
    await page.getByRole('button', { name: 'Apply', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Cancel Apply' })).toBeFocused()
    await expect(page.getByRole('dialog', { name: 'Confirm Apply', exact: true })).toHaveJSProperty(
      'open',
      true
    )
    await expect(page.locator(':modal')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Apply rehearsal' })).not.toBeVisible()
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Apply rehearsal', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible()
    await expect(page.locator('.rehearsal-panel [aria-live="polite"]')).toBeFocused()
    expect(git('rev-parse', 'HEAD^2')).toBe(git('rev-parse', 'topic'))
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('preview\n')
    const appliedHead = git('rev-parse', 'HEAD')
    // Start again immediately while post-Apply history and Undo refreshes run.
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No-op — no branch changes' })).toBeVisible()
    expect(git('rev-parse', 'HEAD')).toBe(appliedHead)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('preview\n')
    await app.evaluate(
      (_electron, missing) => {
        process.env.GIT_CITY_REHEARSE_BIN = missing
      },
      join(userData, 'missing-tool')
    )
    await page.reload()
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await entry.click()
    await expect(page.getByText(/^⚠ Could not start the configured tool/)).toContainText(
      'Could not start the configured tool'
    )
    await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeDisabled()
    await expect(target).toBeDisabled()
    const direct = await page.evaluate(
      async (repo) => window.gitCity.stage(repo, ['file.txt']),
      root
    )
    expect(direct.ok).toBe(true)
  } finally {
    await app.close()
    try {
      execFileSync(tool!, ['--json', 'recover', '--rollback'], { cwd: root })
    } catch {
      /* no pending recovery */
    }
    const listing = JSON.parse(
      execFileSync(tool!, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
    )
    for (const rehearsal of listing.rehearsals)
      execFileSync(tool!, ['--json', 'discard', rehearsal.id], { cwd: root })
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
