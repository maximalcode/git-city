import { discardFixtureRehearsals } from './rehearsal-fixture-cleanup'
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
    await expect(
      editor.getByRole('heading', { name: 'Resolve in sandbox', exact: true })
    ).toBeFocused()
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
    await press('Confirm section 1 edit')
    await press('Save and stage in sandbox')
    await expect(editor.getByRole('alert')).toContainText('Nothing was overwritten')
    await press('Refresh sandbox')
    await expect(
      editor.getByText('external resolution', { exact: true }).filter({ visible: true })
    ).toBeVisible()
    await expect(
      editor.getByRole('group', { name: 'Conflict content' }).getByRole('alert')
    ).toContainText('retained draft is based on sandbox revision')
    await editor.getByRole('button', { name: 'Start from current sandbox', exact: true }).click()
    await app.focus('away')
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
    await writeFile(join(retained.sandbox, 'file.txt'), 'changed while outside the app\n')
    await app.focus('back')
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
    await expect(
      editor.getByText('changed while outside the app', { exact: true }).filter({ visible: true })
    ).toBeVisible()
    await expect(
      editor.getByText(
        '⚠ File reloaded after external changes. Review the current content before saving.',
        {
          exact: true
        }
      )
    ).toBeVisible()
    await press('Edit whole file')
    await editor.getByLabel('Resolved file text').focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await page.keyboard.type('reviewed resolution\n')
    await press('Confirm complete file resolution')
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
    await discardFixtureRehearsals(tool!, root)
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('durable conflict drafts survive file navigation, panel close and restart', async () => {
  const tool = process.env.GIT_CITY_REHEARSE_BIN
  expect(tool, 'Set GIT_CITY_REHEARSE_BIN to a compatible real executable').toBeTruthy()
  const userData = await mkdtemp(join(tmpdir(), 'git-city-draft-user-data-'))
  const root = await mkdtemp(join(tmpdir(), 'git-city-draft-electron-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'one.txt'), 'base one\n')
  await writeFile(join(root, 'two.txt'), 'base two\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'one.txt'), 'topic one\n')
  await writeFile(join(root, 'two.txt'), 'topic two\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  await writeFile(join(root, 'one.txt'), 'main one\n')
  await writeFile(join(root, 'two.txt'), 'main two\n')
  git('commit', '-am', 'main')
  const app = await launchNativeFocusApp(root, userData, tool!)
  try {
    const page = app.page
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    const target = page.getByLabel('Branch or commit to merge into the current checkout')
    await target.fill('topic')
    await page.keyboard.press('Enter')
    const editor = page.getByRole('region', { name: 'Sandbox conflict editor' })
    await expect(editor).toBeVisible()
    const edit = async (path: string, text: string): Promise<void> => {
      await editor.getByRole('button', { name: `Resolve ${path}`, exact: true }).click()
      await editor.getByRole('button', { name: 'Edit whole file', exact: true }).click()
      const field = editor.getByLabel('Resolved file text')
      await field.fill(text)
      await expect(editor).toContainText('Editor draft saved locally')
    }
    await edit('one.txt', 'draft one\n')
    await edit('two.txt', 'draft two\n')
    await page.getByRole('button', { name: 'Close rehearsal panel' }).click()
    await expect(editor).toBeHidden()
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    await editor.getByRole('button', { name: 'Resolve one.txt', exact: true }).click()
    await expect(editor.getByLabel('Resolved file text')).toHaveValue('draft one\n')
    await page.getByRole('button', { name: 'Close rehearsal panel' }).click()
    await expect(editor).toBeHidden()
    const sandbox = await page.evaluate(async (repo) => {
      const listing = await window.gitCity.rehearsalList(repo)
      const shown = await window.gitCity.rehearsalShow(listing.entries[0])
      if (shown.kind !== 'report' || !shown.report.sandbox) throw new Error('missing sandbox')
      return shown.report.sandbox
    }, root)
    await app.close()
    await writeFile(join(sandbox, 'one.txt'), 'external sandbox resolution\n')

    const restarted = await launchNativeFocusApp(root, userData, tool!)
    try {
      await restarted.page.getByRole('button', { name: 'Open a local repository…' }).click()
      await restarted.page.getByRole('button', { name: 'Rehearse panel' }).click()
      const restartedEditor = restarted.page.getByRole('region', {
        name: 'Sandbox conflict editor'
      })
      await restartedEditor.getByRole('button', { name: 'Resolve one.txt', exact: true }).click()
      await expect(
        restartedEditor.getByText(/A retained draft is based on sandbox revision/)
      ).toBeVisible()
      await expect(
        restartedEditor.getByRole('button', { name: 'Save and stage in sandbox' })
      ).toBeDisabled()
      await expect(
        restartedEditor.getByRole('button', { name: 'Confirm complete file resolution' })
      ).toBeDisabled()
      await restartedEditor
        .getByText('Inspect retained draft and its original base', { exact: true })
        .click()
      await expect(restartedEditor.getByRole('alert')).toContainText('draft one')
      await restartedEditor
        .getByRole('button', { name: 'Use retained text as a new draft on the current base' })
        .click()
      await expect(restartedEditor.getByLabel('Resolved file text')).toHaveValue('draft one\n')
      await expect(
        restartedEditor.getByRole('button', { name: 'Save and stage in sandbox' })
      ).toBeDisabled()
      await restarted.page.screenshot({ path: 'test-results/rehearsal-obsolete-draft-restart.png' })
      await restartedEditor.getByRole('button', { name: 'Resolve two.txt', exact: true }).click()
      await expect(restartedEditor.getByLabel('Resolved file text')).toHaveValue('draft two\n')
    } finally {
      await restarted.close()
    }
  } finally {
    try {
      await app.close()
    } catch {
      /* The restart branch already closed the first process. */
    }
    await discardFixtureRehearsals(tool!, root)
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
      await expect(
        editor.getByRole('heading', { name: 'Resolve in sandbox', exact: true })
      ).toBeFocused()
      const listing = JSON.parse(
        execFileSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
      )
      const shown = await page.evaluate(
        (identity) => window.gitCity.rehearsalShow(identity),
        listing.rehearsals[0]
      )
      expect(shown.kind).toBe('report')
      if (shown.kind !== 'report') throw new Error('Expected the retained conflict report.')
      const report = shown.report
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
        await expect(
          editor.getByRole('heading', { name: 'Resolve in sandbox', exact: true })
        ).toBeFocused()
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
      await discardFixtureRehearsals(tool, root)
      await rm(root, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })
}
