import { discardFixtureRehearsals } from './rehearsal-fixture-cleanup'
import { expect, test } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchNativeFocusApp } from './native-focus'

test('two conflict decisions survive restart and later edits invalidate confirmation', async () => {
  test.setTimeout(150_000)
  const tool = process.env.GIT_CITY_REHEARSE_BIN!
  expect(tool).toBeTruthy()
  const root = await mkdtemp(join(tmpdir(), 'city-decisions-'))
  const userData = await mkdtemp(join(tmpdir(), 'city-decisions-profile-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  const content = (first: string, last: string): string =>
    [first, ...Array.from({ length: 18 }, (_, index) => `context ${index}`), last, ''].join('\n')
  await writeFile(join(root, 'two.txt'), content('base first', 'base last'))
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'two.txt'), content('topic first', 'topic last'))
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  await writeFile(join(root, 'two.txt'), content('main first', 'main last'))
  git('commit', '-am', 'main')
  const original = {
    head: git('rev-parse', 'HEAD'),
    index: await readFile(join(root, '.git/index')),
    text: await readFile(join(root, 'two.txt'))
  }
  let app = await launchNativeFocusApp(root, userData, tool)
  try {
    await app.page.getByRole('button', { name: 'Open a local repository…' }).click()
    await app.page.getByRole('button', { name: 'Rehearse panel' }).click()
    await app.page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
    await app.page.keyboard.press('Enter')
    let editor = app.page.getByRole('region', { name: 'Sandbox conflict editor' })
    await editor.getByRole('button', { name: 'Resolve two.txt', exact: true }).click()
    await expect(editor.getByText('2 unreviewed conflict sections.', { exact: true })).toBeVisible()
    const first = editor.getByRole('region', { name: 'Conflict section 1', exact: true })
    await first.getByRole('button', { name: /^Ours/ }).focus()
    await app.page.keyboard.press('Enter')
    await expect(editor.getByText('1 unreviewed conflict sections.', { exact: true })).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Save and stage in sandbox' })).toBeDisabled()
    await expect(editor).toContainText('Editor draft saved locally')
    await app.page.screenshot({ path: 'test-results/rehearsal-explicit-decisions.png' })
    await app.close()
    app = await launchNativeFocusApp(root, userData, tool)
    await app.page.getByRole('button', { name: 'Open a local repository…' }).click()
    await app.page.getByRole('button', { name: 'Rehearse panel' }).click()
    editor = app.page.getByRole('region', { name: 'Sandbox conflict editor' })
    await editor.getByRole('button', { name: 'Resolve two.txt', exact: true }).click()
    await expect(editor.getByText('1 unreviewed conflict sections.', { exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'Next unreviewed section', exact: true }).click()
    const second = editor.getByRole('region', { name: 'Conflict section 2', exact: true })
    await expect(second).toBeFocused()
    await second.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Save and stage in sandbox' })).toBeDisabled()
    await second.getByLabel('Edit conflict hunk').fill('deliberate last\n')
    await expect(editor.getByRole('button', { name: 'Save and stage in sandbox' })).toBeDisabled()
    await second.getByRole('button', { name: 'Confirm section 2 edit' }).click()
    await expect(editor.getByRole('button', { name: 'Save and stage in sandbox' })).toBeEnabled()
    await editor.getByRole('button', { name: 'Edit whole file', exact: true }).click()
    await editor.getByRole('button', { name: 'Confirm complete file resolution' }).click()
    await editor.getByLabel('Resolved file text').fill('final complete resolution\n')
    await expect(editor.getByRole('button', { name: 'Save and stage in sandbox' })).toBeDisabled()
    await editor.getByRole('button', { name: 'Confirm complete file resolution' }).click()
    await editor.getByRole('button', { name: 'Save and stage in sandbox' }).click()
    await expect(editor.getByRole('button', { name: 'Continue rehearsal' })).toBeEnabled()
    expect(git('rev-parse', 'HEAD')).toBe(original.head)
    expect(await readFile(join(root, '.git/index'))).toEqual(original.index)
    expect(await readFile(join(root, 'two.txt'))).toEqual(original.text)
    await app.page.screenshot({ path: 'test-results/rehearsal-complete-resolution.png' })
  } finally {
    await app.close()
    await discardFixtureRehearsals(tool, root)
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
