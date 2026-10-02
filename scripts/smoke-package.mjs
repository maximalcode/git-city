import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const executablePath = resolve(process.argv[2])
const profile = await mkdtemp(join(tmpdir(), 'git-city-package-profile-'))
try {
  // Start the actual packaged executable, twice with the same user profile.
  for (let restart = 0; restart < 2; restart++) {
    const app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${profile}`, '--no-sandbox'],
      env: { ...process.env, GIT_CITY_REHEARSE_BIN: '/must-not-use-development-override' },
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
      const available = await page.evaluate(() => window.gitCity.rehearsalAvailability())
      assert.equal(available.available, true, available.message)
      // Packaging must not publicly activate the feature or allow preview IPC.
      const refused = await page.evaluate(
        (repo) => window.gitCity.rehearseMerge(repo, 'main'),
        profile
      )
      assert.equal(refused.kind, 'unavailable')
      assert.equal(
        await page.getByRole('button', { name: 'Rehearse (internal)', exact: true }).count(),
        0
      )
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
