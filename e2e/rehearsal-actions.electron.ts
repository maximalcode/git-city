import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { discardFixtureRehearsals } from './rehearsal-fixture-cleanup'
import { expectFrozenReview } from './rehearsal-review-assertions'

for (const [entryKind, conflict] of [
  ['branches', false],
  ['graph', false],
  ['detail', false],
  ['branches', true],
  ['graph', true]
] as const) {
  test(
    'real ' +
      entryKind +
      (conflict ? ' conflict blocks Apply' : ' selection previews and confirms Apply'),
    async () => {
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
      await writeFile(join(root, 'independent.txt'), 'main work\n')
      git('add', '.')
      git('commit', '-m', 'independent main')
      if (conflict) {
        await writeFile(join(root, 'file.txt'), 'conflicting main\n')
        git('commit', '-am', 'conflicting main')
      }
      const source = git('rev-parse', 'topic')
      const before = git('rev-parse', 'HEAD')
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
        await expect(page.getByRole('button', { name: 'Rehearse panel' })).toBeVisible()
        await page.keyboard.press('Escape')
        if (entryKind === 'branches') {
          await page.keyboard.press('b')
        } else if (entryKind === 'graph') {
          await page.keyboard.press('g')
          const commit = page.getByRole('button', { name: /^Commit .*: topic$/ })
          await commit.focus()
          await page.keyboard.press('Space')
          await expect(commit).toHaveAttribute('aria-expanded', 'true')
          await page.keyboard.press('Enter')
          await expect(commit).toHaveAttribute('aria-expanded', 'false')
          await page.keyboard.press('Enter')
        } else {
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
          await page.getByPlaceholder('Type a command  ·  @ commits  ·  : code').fill('@' + source)
          await page.getByRole('listbox').getByRole('option').first().click()
        }
        const action = entryKind === 'branches' ? 'rebase' : 'cherry-pick'
        const entry = page.getByRole('button', { name: 'Rehearse ' + action, exact: true })
        await entry.focus()
        await page.keyboard.press('Enter')
        const submit = page.getByRole('button', { name: 'Rehearse', exact: true })
        await expect(submit).toBeFocused()
        const target = page.getByLabel(
          action === 'rebase'
            ? 'Rebase current checkout onto selected branch'
            : 'Selected commit to cherry-pick'
        )
        await expect(target).toHaveValue(action === 'rebase' ? 'topic' : source)
        await expect(target).toHaveAttribute('readonly', '')
        await page.keyboard.press('Enter')
        if (conflict) {
          await expect(
            page.getByRole('heading', { name: 'Conflicts need attention' })
          ).toBeVisible()
          await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
          await expect(page.getByText(/file.txt.*conflict hunks/)).toBeVisible()
          expect(git('rev-parse', 'HEAD')).toBe(before)
          expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('conflicting main\n')
          await page.keyboard.press('Escape')
          await expect(entry).toBeFocused()
          return
        }
        await expect(
          page.getByRole('heading', {
            name: (action === 'rebase' ? 'Rebase' : 'Cherry-pick') + ' preview completed'
          })
        ).toBeVisible()
        expect(git('rev-parse', 'HEAD')).toBe(before)
        await expectFrozenReview(page, root, 'file.txt', 'original\n', 'preview\n')
        await expandRehearsal(page, /^Technical details$/)
        await expect(page.getByText(/Repository hooks were not run/)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(entry).toBeFocused()
        // Reopen the retained report without creating another rehearsal.
        await page.getByRole('button', { name: 'Rehearse panel' }).click()
        await page.getByRole('button', { name: 'Apply', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Cancel Apply' })).toBeFocused()
        await expect(page.getByRole('region', { name: 'Confirm Apply' })).toContainText(action)
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')
        await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible()
        expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('preview\n')
        expect(await readFile(join(root, 'independent.txt'), 'utf8')).toBe('main work\n')
        expect(git('rev-parse', 'HEAD')).not.toBe(before)
        expect(git('rev-parse', 'HEAD^')).toBe(action === 'rebase' ? source : before)
        await page.screenshot({ path: 'test-results/rehearsal-' + entryKind + '.png' })
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
    }
  )
}
