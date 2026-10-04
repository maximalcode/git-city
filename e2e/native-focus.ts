import { chromium, type Browser, type Page } from '@playwright/test'
import { spawn } from 'child_process'
import { once } from 'events'
import { writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { join, resolve } from 'path'

/** Attach without Playwright's forced document focus, for native focus acceptance checks. */
export async function launchNativeFocusApp(
  repo: string,
  userData: string,
  tool: string
): Promise<{
  page: Page
  focus: (direction: 'away' | 'back') => Promise<void>
  close: () => Promise<void>
}> {
  const bootstrap = join(userData, 'native-focus.cjs')
  await writeFile(
    bootstrap,
    `
const { app, BrowserWindow, dialog } = require('electron')
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(repo)}] })
let main, other
process.on('message', async direction => {
  try {
    if (direction === 'away') {
      app.focus({ steal: true })
      main = BrowserWindow.getAllWindows().find(window => window !== other)
      other = new BrowserWindow({ width: 200, height: 100 })
      await other.loadURL('about:blank')
      other.show()
      other.focus()
      other.webContents.focus()
    } else {
      other?.close()
      other = undefined
      main ??= BrowserWindow.getAllWindows()[0]
      app.focus({ steal: true })
      main.show()
      main.focus()
      main.webContents.focus()
    }
    process.send({ ok: true })
  } catch (error) { process.send({ ok: false, message: String(error) }) }
})
require(${JSON.stringify(resolve('out/main/index.js'))})
`
  )
  const executable: string = createRequire(resolve('package.json'))('electron')
  const child = spawn(
    executable,
    [bootstrap, '--remote-debugging-port=0', `--user-data-dir=${userData}`],
    {
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: tool
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    }
  )
  let browser: Browser | undefined
  const close = async (): Promise<void> => {
    await browser?.close()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  }
  try {
    const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
      let output = ''
      child.on('error', reject)
      child.once('exit', () =>
        reject(new Error('Electron exited before exposing its browser endpoint.'))
      )
      child.stderr!.on('data', (chunk) => {
        output = (output + String(chunk)).slice(-8192)
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) resolveEndpoint(match[1])
      })
    })
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true })
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    const focus = async (direction: 'away' | 'back'): Promise<void> => {
      const response = once(child, 'message')
      child.send(direction)
      const [result] = await response
      if (!result.ok) throw new Error(result.message)
    }
    await focus('back')
    return { page, focus, close }
  } catch (error) {
    await close()
    throw error
  }
}
