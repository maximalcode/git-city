import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ProgressInfo } from '../shared/types'
import { analyzeRepo, checkGitInstalled } from './git/analyze'
import { cloneRepo } from './git/clone'

const SAMPLE_TARGET = 50

export function registerIpc(): void {
  ipcMain.handle('git-city:check-git', () => checkGitInstalled())

  ipcMain.handle('git-city:select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open a git repository',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('git-city:analyze', (event, repoPath: string, samples?: number) => {
    const send = (p: ProgressInfo): void => {
      if (!event.sender.isDestroyed()) event.sender.send('git-city:progress', p)
    }
    return analyzeRepo(repoPath, samples ?? SAMPLE_TARGET, send)
  })

  ipcMain.handle('git-city:clone', (event, url: string) => {
    const send = (p: ProgressInfo): void => {
      if (!event.sender.isDestroyed()) event.sender.send('git-city:progress', p)
    }
    return cloneRepo(url, send)
  })
}
