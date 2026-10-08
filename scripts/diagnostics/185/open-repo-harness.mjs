// Temporary #185 minimization driver. It opens a real tiny repository in the
// packaged app, then runs the unchanged CLI smoke without exercising Rehearse
// or Apply in the UI. This isolates the open-repository plus CLI path; it is
// not a replacement for scripts/smoke-package.mjs or release coverage.
import { expect as baseExpect, _electron as electron } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import process from 'node:process'
import {
  bestEffort,
  collectFailureDiagnostics,
  installMainSpawnDiagnostics,
  printProcessDiagnostics,
  readMainSpawnDiagnostics,
  writeDiagnostics
} from '../../smoke-package-diagnostics.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const executableArgument = process.argv[2]

const runAsyncCli = (binary) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn('python3', ['scripts/smoke-rehearse.py', binary], {
      stdio: 'inherit',
      timeout: 180_000
    })
    let settled = false
    child.once('error', (error) => {
      if (settled) return
      settled = true
      rejectRun(error)
    })
    child.once('close', (status, signal) => {
      if (settled) return
      settled = true
      if (status === 0) {
        resolveRun()
        return
      }
      const error = new Error(
        `python3 smoke-rehearse exited with status ${status ?? 'null'} and signal ${signal ?? 'null'}`
      )
      error.status = status
      error.signal = signal
      rejectRun(error)
    })
  })

if (!executableArgument) {
  console.error('[DEBUG-185] usage: node scripts/diagnostics/185/open-repo-harness.mjs <binary>')
  process.exitCode = 2
} else {
  const executablePath = resolve(executableArgument)
  const profile = await mkdtemp(join(tmpdir(), 'git-city-open-repo-profile-'))
  const repo = join(profile, 'repo')
  const diagnosticsDir = join(root, 'test-results', 'package-smoke', 'minimal')
  const diagnosticsGraceMs = Math.min(
    180_000,
    Math.max(0, Number(process.env.GIT_CITY_SMOKE_DIAGNOSTICS_GRACE_MS ?? 180_000) || 0)
  )
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const expect = baseExpect.configure({ timeout: 90_000 })
  let app
  let page
  let appContext
  let failure
  let finalDiagnosticDeadline
  const reportSecondaryFailure = (stage, error) => {
    const code = error?.code ?? error?.name ?? String(error ?? 'unknown')
    console.error(
      `[DEBUG-185] ${JSON.stringify({ event: 'secondary-failure', stage, error: code })}`
    )
    if (!failure) {
      failure = error instanceof Error ? error : new Error(`${stage} failed: ${code}`)
    }
  }

  try {
    await rm(diagnosticsDir, { recursive: true, force: true })
    execFileSync('git', ['init', '-b', 'main', repo])
    git('config', 'user.name', 'Package smoke')
    git('config', 'user.email', 'smoke@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    git('config', 'core.autocrlf', 'false')
    await writeFile(join(repo, 'file.txt'), 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')

    process.chdir(root)
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
    appContext = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      resources: process.resourcesPath,
      platform: process.platform,
      arch: process.arch
    }))
    assert.equal(appContext.packaged, true)
    page = await app.firstWindow()
    await writeDiagnostics(join(diagnosticsDir, 'diagnostics-install.json'), {
      main: mainDiagnosticsInstall,
      graceMs: diagnosticsGraceMs,
      mode: 'open-repo'
    })
    page.setDefaultTimeout(90_000)
    const available = await page.evaluate(() => window.gitCity.rehearsalAvailability())
    assert.equal(available.available, true, available.message)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, repo)
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    await expect(page.getByRole('combobox', { name: /Rehearse mode/ })).toHaveValue('automatic')
    const done = page.getByRole('button', { name: 'Done', exact: true })
    if (await done.isVisible()) await done.click()
    if (process.env.GIT_CITY_185_STOP_WATCH === '1') {
      await page.evaluate(() => window.gitCity.watchStop())
      console.error('[DEBUG-185] repository watcher stopped before Python smoke')
    }

    const binary = join(
      appContext.resources,
      'rehearse',
      appContext.platform === 'win32' ? 'git-rehearse.exe' : 'git-rehearse'
    )
    const useAsyncCli = process.env.GIT_CITY_185_ASYNC_CLI === '1'
    if (useAsyncCli) {
      await runAsyncCli(binary)
    } else {
      execFileSync('python3', ['scripts/smoke-rehearse.py', binary], {
        stdio: 'inherit',
        timeout: 180_000
      })
    }
    console.log(
      JSON.stringify({
        ...appContext,
        mode: 'open-repo',
        smoke: 'passed',
        cliDriver: useAsyncCli ? 'async-spawn' : 'sync-execFileSync'
      })
    )
  } catch (error) {
    failure = error
    const diagnosticsDeadline = Date.now() + diagnosticsGraceMs + 10_000
    const diagnosticsFallback = {
      failure: error,
      mainDiagnostics: { installed: false, records: [], ipcRecords: [] },
      deadlines: { finalDeadline: diagnosticsDeadline }
    }
    let diagnosticsFailure
    const diagnostics = await bestEffort(
      async () => {
        try {
          return await collectFailureDiagnostics({
            app,
            page,
            repo,
            profile,
            directory: diagnosticsDir,
            error,
            graceMs: diagnosticsGraceMs,
            applyRequested: false
          })
        } catch (diagnosticError) {
          diagnosticsFailure = diagnosticError
          return diagnosticsFallback
        }
      },
      diagnosticsFallback,
      diagnosticsDeadline
    )
    if (diagnostics === diagnosticsFallback) {
      reportSecondaryFailure('diagnostics', diagnosticsFailure ?? 'timeout')
    }
    finalDiagnosticDeadline = diagnostics.deadlines.finalDeadline
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
      printProcessDiagnostics('minimal', mainDiagnostics)
      const closed = await bestEffort(
        async () => {
          await app.close()
          return true
        },
        false,
        Date.now() + 10_000
      )
      if (!closed) {
        reportSecondaryFailure('app-close', 'timeout')
        try {
          app.process().kill()
        } catch {
          reportSecondaryFailure('app-kill', 'failed')
        }
      }
    }
    try {
      await rm(profile, { recursive: true, force: true })
    } catch (error) {
      reportSecondaryFailure('profile-cleanup', error)
    }
  }
  if (failure) throw failure
}
