import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'
import { isAppUrl } from './appUrl'

function createWindow(): void {
  const devUrl =
    !app.isPackaged && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : null
  const indexFile = join(__dirname, '../renderer/index.html')
  const appUrl = devUrl ?? pathToFileURL(indexFile).href

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e14',
    title: 'Git City',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // These two are Electron's defaults, spelled out because they are the
      // whole reason the renderer cannot reach Node: the security posture
      // should not rest on a default nobody wrote down (#42).
      contextIsolation: true,
      nodeIntegration: false,
      // The one deliberate exception. A sandboxed preload cannot require our
      // own modules, and the bridge in src/preload needs ipcRenderer.
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // A link out of the app opens in the user's real browser; the window itself
  // never leaves the bundled UI. Without the second handler a top-level
  // navigation would replace the app with a remote page still sitting behind
  // the preload bridge (#42).
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, appUrl)) return
    event.preventDefault()
    // An http(s) link that got here without a target is still a link the user
    // clicked, so honour it the same way the window-open handler does. Anything
    // else (file:, custom schemes) is simply refused.
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  })

  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(indexFile)
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
