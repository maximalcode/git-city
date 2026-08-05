import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'path'
import type { ProgressInfo } from '../shared/types'
import { analyzeRepo, checkGitInstalled } from './git/analyze'
import { cloneRepo } from './git/clone'
import { analysisFailedMessage } from './git/openErrors'
import { FriendlyError } from './git/result'
import { registerOpsIpc } from './ipcOps'

const SAMPLE_TARGET = 50

export function registerIpc(): void {
  registerOpsIpc()

  ipcMain.handle('git-city:check-git', () => checkGitInstalled())

  ipcMain.handle('git-city:select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open a git repository',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('git-city:analyze', async (event, repoPath: string, samples?: number) => {
    const send = (p: ProgressInfo): void => {
      if (!event.sender.isDestroyed()) event.sender.send('git-city:progress', p)
    }
    try {
      return await analyzeRepo(repoPath, samples ?? SAMPLE_TARGET, send)
    } catch (err) {
      throw friendly(err, () => analysisFailedMessage(basename(repoPath)), 'analyze')
    }
  })

  ipcMain.handle('git-city:clone', async (event, url: string) => {
    const send = (p: ProgressInfo): void => {
      if (!event.sender.isDestroyed()) event.sender.send('git-city:progress', p)
    }
    try {
      return await cloneRepo(url, app.getPath('userData'), send)
    } catch (err) {
      throw friendly(err, () => 'Could not clone that repository.', 'clone')
    }
  })
}

/**
 * The same boundary `readOnly` enforces in ipcOps, for the two channels that
 * live here. A FriendlyError was written for the user; anything else is raw git
 * stderr — full of absolute paths, or the internal command line plus "exited
 * with null" — which reads as though the app broke something (#25). Log the
 * detail where a maintainer can find it, show the user a sentence.
 */
function friendly(err: unknown, fallback: () => string, channel: string): Error {
  if (err instanceof FriendlyError) return new Error(err.message)
  console.error(`[git-city] ${channel} failed:`, err)
  return new Error(fallback())
}
