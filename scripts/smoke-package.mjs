import { expect as baseExpect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import {
  applyHasReturned,
  applyHasStarted,
  bestEffort,
  capturePageEvidence,
  capturePostApplyPublicState,
  diagnosticDeadlines,
  installMainSpawnDiagnostics,
  printProcessDiagnostics,
  readMainSpawnDiagnostics,
  snapshotRepo,
  snapshotRetainedMetadata,
  writeDiagnostics
} from './smoke-package-diagnostics.mjs'

const executablePath = resolve(process.argv[2])
const restarts = Number(process.env.GIT_CITY_SMOKE_RESTARTS ?? 2)
assert.ok(Number.isInteger(restarts) && restarts >= 2 && restarts <= 10)
const profile = await mkdtemp(join(tmpdir(), 'git-city-package-profile-'))
const repo = join(profile, 'repo')
const diagnosticsGraceMs = Math.min(
  180_000,
  Math.max(0, Number(process.env.GIT_CITY_SMOKE_DIAGNOSTICS_GRACE_MS ?? 180_000) || 0)
)
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
  for (let restart = 0; restart < restarts; restart++) {
    git('checkout', 'topic')
    await writeFile(join(repo, 'file.txt'), `preview ${restart}\n`)
    git('commit', '-am', `topic ${restart}`)
    const target = git('rev-parse', 'HEAD')
    git('checkout', 'main')
    const before = git('rev-parse', 'HEAD')
    const diagnosticsDir = join(
      process.cwd(),
      'test-results',
      'package-smoke',
      `${process.platform}-${restart}`
    )
    await rm(diagnosticsDir, { recursive: true, force: true })
    const expectedFile = `preview ${restart}\n`
    await writeDiagnostics(join(diagnosticsDir, 'manifest.json'), {
      platform: process.platform,
      restart,
      target,
      before,
      expectedFile: {
        path: 'file.txt',
        bytes: Buffer.byteLength(expectedFile),
        sha256: createHash('sha256').update(expectedFile).digest('hex')
      }
    })
    let app
    let page
    let failure
    let diagnosticDeadline
    let finalDiagnosticDeadline
    try {
      app = await electron.launch({
        executablePath,
        args: [`--user-data-dir=${profile}`, '--no-sandbox'],
        env: {
          ...process.env,
          GIT_CITY_REHEARSE_BIN: '/must-not-use-development-override',
          GIT_REHEARSE_CACHE_DIR: join(profile, 'cache')
        },
        timeout: 90_000
      })
      const mainDiagnosticsInstall = await installMainSpawnDiagnostics(app)
      const context = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        resources: process.resourcesPath,
        platform: process.platform,
        arch: process.arch
      }))
      assert.equal(context.packaged, true)
      page = await app.firstWindow()
      await writeDiagnostics(join(diagnosticsDir, 'diagnostics-install.json'), {
        main: mainDiagnosticsInstall,
        graceMs: diagnosticsGraceMs
      })
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
      assert.equal(await readFile(join(repo, 'file.txt'), 'utf8'), expectedFile)
      await writeDiagnostics(
        join(diagnosticsDir, 'post-apply-repo.json'),
        await snapshotRepo(repo, 'post-apply')
      )
      try {
        await writeDiagnostics(
          join(diagnosticsDir, 'post-apply-public.json'),
          await capturePostApplyPublicState(page, repo)
        )
      } catch (error) {
        await writeDiagnostics(join(diagnosticsDir, 'post-apply-public-error.json'), {
          error: error instanceof Error ? error.message : String(error)
        })
      }
      const binary = join(
        context.resources,
        'rehearse',
        context.platform === 'win32' ? 'git-rehearse.exe' : 'git-rehearse'
      )
      if (!process.env.GIT_CITY_APPLY_PROBE)
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
    } catch (error) {
      failure = error
      const deadlines = diagnosticDeadlines(Date.now(), diagnosticsGraceMs)
      const initialDeadline = deadlines.initialDeadline
      diagnosticDeadline = deadlines.observationDeadline
      finalDiagnosticDeadline = deadlines.finalDeadline
      const errorDeadline = initialDeadline
      const initialSafe = (operation, fallback) => bestEffort(operation, fallback, initialDeadline)
      const safe = (operation, fallback) => bestEffort(operation, fallback, diagnosticDeadline)
      const finalSafe = (operation, fallback) =>
        bestEffort(operation, fallback, finalDiagnosticDeadline)
      const emptyMainDiagnostics = {
        installed: false,
        installError: 'Diagnostics were unavailable.',
        records: [],
        ipcRecords: []
      }
      await bestEffort(
        () =>
          writeDiagnostics(join(diagnosticsDir, 'original-error.json'), {
            name: error?.name,
            message: error?.message,
            stack: error?.stack,
            graceMs: diagnosticsGraceMs
          }),
        undefined,
        errorDeadline
      )
      let mainDiagnostics = await initialSafe(
        () => readMainSpawnDiagnostics(app, initialDeadline),
        emptyMainDiagnostics
      )
      await initialSafe(
        () =>
          writeDiagnostics(join(diagnosticsDir, 'original-timeout-apply-ipc.json'), {
            main: mainDiagnostics
          }),
        undefined
      )
      await initialSafe(
        async () =>
          writeDiagnostics(
            join(diagnosticsDir, 'original-timeout-repo.json'),
            await snapshotRepo(repo, 'original-timeout')
          ),
        undefined
      )
      await initialSafe(
        async () =>
          writeDiagnostics(
            join(diagnosticsDir, 'original-timeout-retained-metadata.json'),
            await snapshotRetainedMetadata(profile, repo, 'original-timeout')
          ),
        undefined
      )
      await initialSafe(
        () => capturePageEvidence(page, diagnosticsDir, 'original-timeout', initialDeadline),
        undefined
      )
      if (applyHasStarted(mainDiagnostics)) {
        while (Date.now() < diagnosticDeadline && !applyHasReturned(mainDiagnostics)) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1_000, diagnosticDeadline - Date.now()))
          )
          mainDiagnostics = await safe(
            () => readMainSpawnDiagnostics(app, diagnosticDeadline),
            emptyMainDiagnostics
          )
        }
      }
      await finalSafe(
        () => capturePageEvidence(page, diagnosticsDir, 'after-grace', finalDiagnosticDeadline),
        undefined
      )
      await finalSafe(
        async () =>
          writeDiagnostics(
            join(diagnosticsDir, 'after-grace-repo.json'),
            await snapshotRepo(repo, 'after-grace')
          ),
        undefined
      )
      await finalSafe(
        async () =>
          writeDiagnostics(
            join(diagnosticsDir, 'after-grace-retained-metadata.json'),
            await snapshotRetainedMetadata(profile, repo, 'after-grace')
          ),
        undefined
      )
      await finalSafe(
        () => writeDiagnostics(join(diagnosticsDir, 'after-grace-apply-ipc.json'), mainDiagnostics),
        undefined
      )
      if (applyHasReturned(mainDiagnostics)) {
        await finalSafe(
          async () =>
            writeDiagnostics(
              join(diagnosticsDir, 'after-grace-public.json'),
              await capturePostApplyPublicState(page, repo, finalDiagnosticDeadline)
            ),
          undefined
        )
      }
    } finally {
      if (app) {
        const finalDeadline = finalDiagnosticDeadline ?? Date.now() + 10_000
        const mainDiagnostics = await bestEffort(
          () => readMainSpawnDiagnostics(app, finalDeadline),
          { installed: false, records: [], ipcRecords: [] },
          finalDeadline
        )
        await bestEffort(
          () => writeDiagnostics(join(diagnosticsDir, 'process-timing.json'), mainDiagnostics),
          undefined,
          finalDeadline
        )
        printProcessDiagnostics(restart, mainDiagnostics)
        const closed = await bestEffort(
          async () => {
            await app.close()
            return true
          },
          false,
          finalDeadline
        )
        if (!closed) {
          try {
            app.process().kill()
          } catch {
            // The bounded close is best effort; the original assertion remains authoritative.
          }
        }
      }
    }
    if (failure) throw failure
  }
} finally {
  await rm(profile, { recursive: true, force: true })
}
