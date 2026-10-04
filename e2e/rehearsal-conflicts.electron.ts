import { expandRehearsal } from './rehearsal-ui'
import { test, expect } from '@playwright/test'
import { launchNativeFocusApp } from './native-focus'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

test('keyboard sandbox conflict resolution preserves the original until checked Apply', async () => {
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
  git('checkout', 'main')
  await writeFile(join(root, 'file.txt'), 'main conflict\n')
  git('commit', '-am', 'main conflict')
  const before = {
    head: git('rev-parse', 'HEAD'),
    index: await readFile(join(root, '.git/index')),
    file: await readFile(join(root, 'file.txt'))
  }
  const app = await launchNativeFocusApp(root, userData, tool!)
  try {
    const page = app.page
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    const entry = page.getByRole('button', { name: 'Rehearse panel' })
    await entry.focus()
    await page.keyboard.press('Enter')
    const target = page.getByLabel('Branch or commit to merge into the current checkout')
    await expect(target).toBeFocused()
    await target.fill('topic')
    await page.keyboard.press('Enter')
    const editor = page.getByRole('region', { name: 'Sandbox conflict editor' })
    await expect(editor).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    const press = async (name: string): Promise<void> => {
      const button = editor.getByRole('button', { name, exact: true })
      await button.focus()
      await page.keyboard.press('Enter')
    }
    await press('Resolve file.txt')
    await expect(editor.getByRole('heading')).toBeFocused()
    // Every hunk action is reachable by sequential Tab navigation.
    await page.keyboard.press('Tab')
    await expect(
      editor.getByRole('button', { name: 'Resolve file.txt', exact: true })
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(editor.getByRole('button', { name: /^Ours/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(editor.getByRole('button', { name: /^Theirs/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(editor.getByRole('button', { name: 'Both', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(editor.getByRole('button', { name: 'Edit', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(editor.getByLabel('Edit conflict hunk')).toBeFocused()
    await page.keyboard.type('first draft')
    const listing = JSON.parse(
      execFileSync(tool!, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
    )
    const retained = JSON.parse(
      execFileSync(tool!, ['--json', 'show', listing.rehearsals[0].id], {
        cwd: root,
        encoding: 'utf8'
      })
    )
    await writeFile(join(retained.sandbox, 'file.txt'), 'external resolution\n')
    await press('Save and stage in sandbox')
    await expect(editor.getByRole('alert')).toContainText('Nothing was overwritten')
    await press('Refresh sandbox')
    await expect(editor.getByText('external resolution', { exact: true })).toBeVisible()
    await app.focus('away')
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
    await writeFile(join(retained.sandbox, 'file.txt'), 'changed while outside the app\n')
    await app.focus('back')
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
    await expect(editor.getByText('changed while outside the app', { exact: true })).toBeVisible()
    await expect(editor.getByRole('alert')).toContainText('File reloaded after external changes')
    await press('Edit whole file')
    await editor.getByLabel('Resolved file text').focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await page.keyboard.type('reviewed resolution\n')
    await press('Save and stage in sandbox')
    await expect(editor.getByRole('button', { name: 'Continue rehearsal' })).toBeEnabled()
    expect(git('rev-parse', 'HEAD')).toBe(before.head)
    expect(await readFile(join(root, '.git/index'))).toEqual(before.index)
    expect(await readFile(join(root, 'file.txt'))).toEqual(before.file)
    await page.screenshot({ path: 'test-results/rehearsal-conflicts-electron.png' })
    await press('Continue rehearsal')
    await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
    const expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: retained.sandbox,
      encoding: 'utf8'
    }).trim()
    await page.getByRole('button', { name: 'Apply', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Cancel Apply' })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible()
    expect(git('rev-parse', 'HEAD')).toBe(expectedHead)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('reviewed resolution\n')
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

for (const scenario of ['binary', 'delete', 'rename'] as const) {
  test(`keyboard ${scenario} resolution and external return refresh`, async () => {
    const tool = process.env.GIT_CITY_REHEARSE_BIN!
    expect(tool).toBeTruthy()
    const userData = await mkdtemp(join(tmpdir(), 'city-user-'))
    const root = await mkdtemp(join(tmpdir(), 'city-special-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    await writeFile(join(root, 'file'), scenario === 'binary' ? Buffer.from([0, 255]) : 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'topic')
    if (scenario === 'rename') git('mv', 'file', 'topic-name')
    else
      await writeFile(join(root, 'file'), scenario === 'binary' ? Buffer.from([0, 254]) : 'topic\n')
    git('add', '.')
    git('commit', '-m', 'topic')
    git('checkout', 'main')
    if (scenario === 'delete') git('rm', 'file')
    else if (scenario === 'rename') git('mv', 'file', 'main-name')
    else await writeFile(join(root, 'file'), Buffer.from([0, 253]))
    git('add', '.')
    git('commit', '-m', 'main')
    const head = git('rev-parse', 'HEAD')
    const index = await readFile(join(root, '.git/index'))
    const app = await launchNativeFocusApp(root, userData, tool)
    try {
      const page = app.page
      await page.getByRole('button', { name: 'Open a local repository…' }).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Rehearse panel' }).focus()
      await page.keyboard.press('Enter')
      await expandRehearsal(page, /Rehearse again|Choose rehearsal target/)
      await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
      await page.keyboard.press('Enter')
      const editor = page.getByRole('region', { name: 'Sandbox conflict editor' })
      await expect(editor).toBeVisible()
      const button = editor.getByRole('button', { name: /^Resolve / }).first()
      await expect(button).toBeEnabled()
      await button.focus()
      await page.keyboard.press('Enter')
      await expect(editor.getByRole('heading')).toBeFocused()
      const listing = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
      )
      const report = JSON.parse(
        execFileSync(tool, ['--json', 'show', listing.rehearsals[0].id], {
          cwd: root,
          encoding: 'utf8'
        })
      )
      if (scenario === 'binary') {
        await expect(
          editor.getByRole('group', { name: 'Binary conflict: choose a complete version' })
        ).toBeVisible()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Tab')
        await expect(editor.getByRole('button', { name: 'Use ours in sandbox' })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(editor.getByRole('button', { name: 'Use theirs in sandbox' })).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(editor.getByRole('heading')).toBeFocused()
        expect(await readFile(join(report.sandbox, 'file'))).toEqual(Buffer.from([0, 254]))
      } else {
        await expect(editor.getByRole('status')).toContainText('Deletion or rename conflict')
        await expect(editor.getByText(/stage each resolved path/)).toBeVisible()
        await app.focus('away')
        execFileSync(
          'git',
          ['rm', '-f', '--', ...report.conflicts.map((c: { path: string }) => c.path)],
          { cwd: report.sandbox }
        )
        await app.focus('back')
      }
      await expect(editor.getByRole('button', { name: 'Continue rehearsal' })).toBeEnabled()
      expect(git('rev-parse', 'HEAD')).toBe(head)
      expect(await readFile(join(root, '.git/index'))).toEqual(index)
      await editor.getByRole('button', { name: 'Continue rehearsal' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
      await page.screenshot({ path: `test-results/rehearsal-${scenario}.png` })
    } finally {
      await app.close()
      const listing = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
      )
      for (const rehearsal of listing.rehearsals)
        execFileSync(tool, ['--json', 'discard', rehearsal.id], { cwd: root })
      await rm(root, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })
}
