import { expect as baseExpect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const executablePath = resolve(process.argv[2])
const profile = await mkdtemp(join(tmpdir(), 'git-city-package-profile-'))
const repo = join(profile, 'repo')
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
execFileSync('git', ['init', '-b', 'main', repo])
git('config', 'user.name', 'Package smoke')
git('config', 'user.email', 'smoke@example.invalid')
git('config', 'commit.gpgSign', 'false')
git('config', 'core.autocrlf', 'false')
await writeFile(join(repo, 'file.txt'), 'base\n')
git('add', '.')
git('commit', '-m', 'base')
git('branch', 'topic')
const expect = baseExpect.configure({ timeout: 90_000 })
try {
  // Start the actual packaged executable, twice with the same user profile.
  for (let restart = 0; restart < 2; restart++) {
    git('checkout', 'topic')
    await writeFile(join(repo, 'file.txt'), `preview ${restart}\n`)
    git('commit', '-am', `topic ${restart}`)
    const target = git('rev-parse', 'HEAD')
    git('checkout', 'main')
    const before = git('rev-parse', 'HEAD')
    const app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${profile}`, '--no-sandbox'],
      env: {
        ...process.env,
        GIT_CITY_REHEARSE_BIN: '/must-not-use-development-override',
        GIT_REHEARSE_CACHE_DIR: join(profile, 'cache')
      },
      timeout: 90_000
    })
    try {
      const context = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        resources: process.resourcesPath,
        platform: process.platform,
        arch: process.arch
      }))
      assert.equal(context.packaged, true)
      const page = await app.firstWindow()
      page.setDefaultTimeout(90_000)
      const available = await page.evaluate(() => window.gitCity.rehearsalAvailability())
      assert.equal(available.available, true, available.message)
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, repo)
      await page.getByRole('button', { name: 'Open a local repository…' }).click()
      const done = page.getByRole('button', { name: 'Done', exact: true })
      await expect(page.getByRole('combobox', { name: /Rehearse mode/ })).toHaveValue('automatic')
      if (await done.isVisible()) await done.click()
      await page.getByRole('button', { name: 'Rehearse panel', exact: true }).focus()
      await page.keyboard.press('Enter')
      const targetInput = page.getByLabel('Branch or commit to merge into the current checkout')
      await expect(
        page.getByRole('complementary', { name: 'Rehearse merge', exact: true })
      ).toBeVisible()
      const again = page.getByText('Rehearse again', { exact: true })
      if (await again.isVisible()) await again.click()
      await targetInput.fill('topic')
      await page.getByRole('button', { name: 'Rehearse', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
      assert.equal(git('rev-parse', 'HEAD'), before)
      await page.getByRole('button', { name: 'Apply', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: 'Cancel Apply', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Apply rehearsal', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible()
      assert.equal(git('rev-parse', 'HEAD'), target)
      assert.equal(await readFile(join(repo, 'file.txt'), 'utf8'), `preview ${restart}\n`)
      const binary = join(
        context.resources,
        'rehearse',
        context.platform === 'win32' ? 'git-rehearse.exe' : 'git-rehearse'
      )
      execFileSync('python3', ['scripts/smoke-rehearse.py', binary], {
        stdio: 'inherit',
        timeout: 180_000
      })
      const license = join(context.resources, 'rehearse', 'LICENSE')
      const original = await readFile(license)
      try {
        await writeFile(license, 'damaged license')
        const damaged = await page.evaluate(() => window.gitCity.rehearsalAvailability())
        assert.equal(damaged.available, false)
        assert.match(damaged.message, /Repair or reinstall/)
        const result = await page.evaluate(
          (path) => window.gitCity.rehearseMerge(path, 'topic'),
          repo
        )
        assert.notEqual(result.kind, 'report')
        assert.equal(git('rev-parse', 'HEAD'), target)
        assert.equal(
          (await page.evaluate((path) => window.gitCity.rehearsalMode(path, []), repo)).mode,
          'automatic'
        )
      } finally {
        await writeFile(license, original)
      }
      assert.equal(
        (await page.evaluate(() => window.gitCity.rehearsalAvailability())).available,
        true
      )
      console.log(JSON.stringify({ ...context, restart, smoke: 'passed' }))
    } finally {
      await app.close()
    }
  }
} finally {
  await rm(profile, { recursive: true, force: true })
}
