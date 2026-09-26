import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

for (const entry of ['merge', 'rebase', 'graph', 'detail', 'interactive'] as const) {
  test(`Automatic routes the existing ${entry} entry to a retained preview`, async () => {
    const tool = process.env.GIT_CITY_REHEARSE_BIN!
    expect(tool).toBeTruthy()
    const userData = await mkdtemp(join(tmpdir(), 'city-mode-user-'))
    const root = await mkdtemp(join(tmpdir(), 'city-mode-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    await writeFile(join(root, 'base'), 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'topic')
    await writeFile(join(root, 'topic'), 'topic\n')
    git('add', '.')
    git('commit', '-m', 'topic')
    git('checkout', 'main')
    await writeFile(join(root, 'main'), 'main\n')
    git('add', '.')
    git('commit', '-m', 'main')
    const before = git('rev-parse', 'HEAD')
    const index = await readFile(join(root, '.git/index'))
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
      }, root)
      const page = await app.firstWindow()
      await page.getByRole('button', { name: 'Open a local repository…' }).click()
      await expect(page.getByLabel('Rehearse mode (internal)')).toHaveValue('automatic')
      await page.keyboard.press('Escape')
      if (entry === 'merge' || entry === 'rebase' || entry === 'interactive') {
        await page.keyboard.press('b')
        if (entry === 'interactive') {
          await page.getByTitle('Interactive rebase', { exact: true }).click()
          await page
            .locator('.rebase-row')
            .first()
            .getByRole('button', { name: 'drop', exact: true })
            .click()
          await page.getByRole('button', { name: /^Rebase \d+ commits/ }).click()
          await page
            .getByRole('alertdialog')
            .getByRole('button', { name: 'Rebase', exact: true })
            .click()
        } else {
          await page
            .getByRole('button', { name: entry === 'merge' ? 'Merge' : 'Rebase', exact: true })
            .focus()
          await page.keyboard.press('Enter')
        }
      } else {
        if (entry === 'graph') {
          await page.keyboard.press('g')
          await page.getByRole('button', { name: /^Commit .*: topic$/ }).click()
        } else {
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
          await page
            .getByPlaceholder('Type a command  ·  @ commits  ·  : code')
            .fill('@' + git('rev-parse', 'topic'))
          await page.getByRole('listbox').getByRole('option').first().click()
        }
        await page.getByRole('button', { name: /^(⤷ )?Cherry-pick$/ }).click()
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Cherry-pick', exact: true })
          .click()
      }
      await expect(page.getByRole('heading', { name: /preview completed/ })).toBeVisible()
      expect(git('rev-parse', 'HEAD')).toBe(before)
      expect(await readFile(join(root, '.git/index'))).toEqual(index)
      await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()
      await page.screenshot({ path: `test-results/mode-automatic-${entry}.png` })
    } finally {
      await app.close()
      const list = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
      )
      for (const item of list.rehearsals)
        execFileSync(tool, ['--json', 'discard', item.id], { cwd: root })
      await rm(root, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })
}

test('known repository choice, linked-worktree restart, missing tool and explicit Off preserve recovery safety', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  const userData = await mkdtemp(join(tmpdir(), 'city-mode-migration-'))
  const root = await mkdtemp(join(tmpdir(), 'city-mode-restart-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'file'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'file'), 'topic\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  const linked = join(root, 'linked')
  git('worktree', 'add', '-b', 'linked', linked)
  const before = git('rev-parse', 'linked')
  const launch = (executable: string) =>
    electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: executable
      }
    })
  let app = await launch(tool)
  try {
    let page = await app.firstWindow()
    await page.evaluate(
      (path) => localStorage.setItem('gitcity.recent', JSON.stringify([path])),
      root
    )
    await page.reload()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, linked)
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    const chooser = page.getByRole('dialog', { name: 'Choose a Rehearse mode' })
    await expect(chooser).toBeVisible()
    await expect(chooser.getByRole('button', { name: 'Automatic', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(chooser).not.toBeVisible()
    await expect(page.getByLabel('Rehearse mode (internal)')).toHaveValue('ask')
    await page.keyboard.press('Escape')
    await page.keyboard.press('b')
    await expect(
      page.getByRole('button', { name: 'Rehearse rebase', exact: true }).first()
    ).toBeVisible()
    await page.getByLabel('Rehearse mode (internal)').selectOption('automatic')
    await expect
      .poll(() => page.evaluate((path) => window.gitCity.rehearsalMode(path, []), root))
      .toMatchObject({ mode: 'automatic' })
    // An old renderer or a direct bridge caller cannot bypass Automatic.
    const refused = await page.evaluate((path) => window.gitCity.merge(path, 'topic'), linked)
    expect(refused.ok).toBe(false)
    expect(git('rev-parse', 'linked')).toBe(before)
    await app.close()
    app = await launch('')
    page = await app.firstWindow()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, root)
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await expect(page.getByLabel('Rehearse mode (internal)')).toHaveValue('automatic')
    await expect(page.getByRole('dialog', { name: 'Choose a Rehearse mode' })).not.toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('b')
    await page
      .locator('.branch-row')
      .filter({ has: page.getByText('topic', { exact: true }) })
      .getByRole('button', { name: 'Merge', exact: true })
      .click()
    await expect(page.getByRole('dialog', { name: 'Rehearse merge', exact: true })).toContainText(
      'Configure GIT_CITY_REHEARSE_BIN'
    )
    expect(git('rev-parse', 'HEAD')).toBe(before)
    await page.keyboard.press('Escape')
    await page.getByLabel('Rehearse mode (internal)').selectOption('off')
    await expect
      .poll(() => page.evaluate((path) => window.gitCity.rehearsalMode(path, []), linked))
      .toMatchObject({ mode: 'off' })
    await expect(page.getByRole('button', { name: 'Rehearse rebase', exact: true })).toHaveCount(0)
    await page
      .locator('.branch-row')
      .filter({ has: page.getByText('topic', { exact: true }) })
      .getByRole('button', { name: 'Merge', exact: true })
      .click()
    await expect.poll(() => git('rev-parse', 'HEAD')).toBe(git('rev-parse', 'topic'))
    await writeFile(join(root, '.git/rehearse-apply'), 'unreadable interrupted operation')
    const recovery = await page.evaluate((path) => window.gitCity.merge(path, 'topic'), linked)
    expect(recovery.ok).toBe(false)
    expect(recovery.message).toContain('blocked')
    expect(git('rev-parse', 'linked')).toBe(before)
    await page.screenshot({ path: 'test-results/mode-off-restart.png' })
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('unpackaged production renderer ignores internal preferences without hiding required choices', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'city-mode-production-'))
  const root = await mkdtemp(join(tmpdir(), 'city-mode-production-repo-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'file'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'file'), 'topic\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  // Simulate an internal installation awaiting the existing-user choice.
  await writeFile(
    join(userData, 'rehearsal-modes.json'),
    JSON.stringify({
      schema: 1,
      legacy: [root],
      repositories: {}
    })
  )
  const app = await electron.launch({
    args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      GIT_CITY_REHEARSE_BIN: process.env.GIT_CITY_REHEARSE_BIN!
    }
  })
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, root)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await expect(page.getByRole('button', { name: 'Branches', exact: true })).toBeVisible()
    expect(await page.evaluate((path) => window.gitCity.rehearsalMode(path, []), root)).toBeNull()
    await expect(page.getByLabel('Rehearse mode (internal)')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rehearse (internal)' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('b')
    await page.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect.poll(() => git('rev-parse', 'HEAD')).toBe(git('rev-parse', 'topic'))
    // The hidden development preference was not converted or overwritten.
    expect(
      JSON.parse(await readFile(join(userData, 'rehearsal-modes.json'), 'utf8')).legacy
    ).toEqual([root])
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
