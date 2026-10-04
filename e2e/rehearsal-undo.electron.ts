import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

test('interrupted exact Undo survives restart and blocks writes across worktrees', async () => {
  test.setTimeout(600_000)
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const root = await mkdtemp(join(tmpdir(), 'git-city-recovery-ui-'))
  const userData = await mkdtemp(join(tmpdir(), 'git-city-recovery-profile-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'file.txt'), 'before\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'file.txt'), 'after\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  const linked = join(root, 'linked')
  git('worktree', 'add', '-b', 'other', linked)
  const launch = (abort = false) =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: tool,
        ...(abort ? { GIT_REHEARSE_ABORT_UNDO_AT: 'after-ref-transaction' } : {})
      }
    })
  let app = await launch(true)
  const open = async (path: string) => {
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, path)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    return page
  }
  try {
    let page = await open(root)
    await page.getByRole('button', { name: 'Rehearse (internal)' }).click()
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
    await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.getByRole('button', { name: 'Apply rehearsal', exact: true }).click()
    await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible({
      timeout: 180_000
    })
    await expandRehearsal(page, /^Undo Apply/)
    const undo = page.getByRole('button', { name: 'Undo Apply', exact: true })
    await expect(undo).toBeEnabled()
    await undo.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Cancel Undo' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(undo).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Undo this Apply' })).toBeFocused()
    await page.keyboard.press('Enter')
    const outcome = page.getByText(/Undo response was lost or incomplete/)
    await expect(outcome).toBeVisible()
    // A mandatory recovery notice now sits outside the nonmodal panel and takes priority.
    await expect(page.getByRole('heading', { name: '⚠ Recovery required' })).toBeFocused()
    await page.getByRole('button', { name: 'Close rehearsal panel' }).click()
    await expect(page.getByRole('heading', { name: '⚠ Recovery required' })).toBeVisible()
    await app.close()

    app = await launch()
    page = await open(linked)
    await expect(page.getByRole('heading', { name: '⚠ Recovery required' })).toBeVisible()
    const foreignIndex = await readFile(join(root, '.git/worktrees/linked/index'))
    const refused = await page.evaluate(
      async (repo) => window.gitCity.stage(repo, ['file.txt']),
      linked
    )
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('blocked')
    expect(await readFile(join(root, '.git/worktrees/linked/index'))).toEqual(foreignIndex)
    await expect(page.getByRole('button', { name: 'Complete interrupted undo' })).not.toBeVisible()
    await app.close()

    app = await launch()
    page = await open(root)
    const heading = page.getByRole('heading', { name: '⚠ Recovery required' })
    await expect(heading).toBeFocused()
    const complete = page.getByRole('button', { name: 'Complete interrupted undo' })
    await expect(complete).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(complete).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(heading).not.toBeVisible()
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('before\n')
    expect(git('rev-parse', 'HEAD')).toBe(git('rev-parse', 'topic~1'))
  } finally {
    await app.close()
    try {
      execFileSync(tool, ['--json', 'recover', '--rollback'], { cwd: root })
    } catch {
      /* already clear */
    }
    const list = JSON.parse(execFileSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' }))
    for (const entry of list.rehearsals)
      execFileSync(tool, ['--json', 'discard', entry.id], { cwd: root })
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
