import {
  readRehearsalConflict,
  saveRehearsalConflict,
  openRehearsalConflict,
  continueRehearsal
} from './rehearsalConflicts'
import {
  applyRehearsal,
  inspectRecovery,
  recoverRehearsal,
  withRepositoryWrite
} from './rehearsalRecovery'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename } from 'path'
import { rehearsalAvailability, rehearse, rehearseMerge, rehearsalShow } from './rehearsal'
import type { RehearsalAction, RehearsalIdentity, RehearsalReport } from '../shared/types'
import type { ProgressInfo } from '../shared/types'
import { analyze, checkGitInstalled } from './git/analyze'
import { cloneRepo } from './git/clone'
import { analysisFailedMessage } from './git/openErrors'
import { FriendlyError } from './git/result'
import { withRepoLock } from './git/queue'
import { registerOpsIpc } from './ipcOps'

export function registerIpc(): void {
  registerOpsIpc()

  // Deliberately outside the retrying mutation helper; never fall back to git merge.
  const rehearsalTool = (): string | undefined =>
    app.isPackaged ? undefined : process.env.GIT_CITY_REHEARSE_BIN
  ipcMain.handle('git-city:rehearsal-availability', () => rehearsalAvailability(rehearsalTool()))
  ipcMain.handle(
    'git-city:rehearse',
    (_event, repo: string, action: RehearsalAction, target: string) =>
      rehearse(rehearsalTool(), repo, action, target)
  )
  ipcMain.handle('git-city:rehearse-merge', (_event, repo: string, target: string) =>
    rehearseMerge(rehearsalTool(), repo, target)
  )
  ipcMain.handle('git-city:rehearsal-show', (_event, identity: RehearsalIdentity) =>
    rehearsalShow(rehearsalTool(), identity)
  )

  ipcMain.handle('git-city:rehearsal-conflict-read', (_event, identity, path) =>
    readRehearsalConflict(rehearsalTool(), identity, path)
  )
  ipcMain.handle('git-city:rehearsal-conflict-save', (_event, identity, path, revision, text) =>
    saveRehearsalConflict(rehearsalTool(), identity, path, revision, text)
  )
  ipcMain.handle('git-city:rehearsal-conflict-open', (_event, identity, path) =>
    openRehearsalConflict(rehearsalTool(), identity, path, shell.openPath)
  )
  ipcMain.handle('git-city:rehearsal-continue', (_event, identity) =>
    continueRehearsal(rehearsalTool(), identity)
  )

  ipcMain.handle('git-city:rehearsal-apply', (_event, identity: RehearsalReport) =>
    applyRehearsal(rehearsalTool(), identity)
  )
  ipcMain.handle('git-city:rehearsal-recovery', (_event, repo: string) =>
    withRepositoryWrite(repo, () => inspectRecovery(rehearsalTool(), repo))
  )
  ipcMain.handle(
    'git-city:rehearsal-recover',
    (_event, repo: string, id: string, action: 'complete' | 'rollback') =>
      recoverRehearsal(rehearsalTool(), repo, id, action)
  )

  ipcMain.handle('git-city:check-git', () => checkGitInstalled())

  ipcMain.handle('git-city:select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open a git repository',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // The one analysis channel: incremental splice versus full replay is decided
  // behind analyze() (#112), and the lock covers whichever path ran.
  ipcMain.handle('git-city:analyze', async (event, repoPath: string) => {
    const send = (p: ProgressInfo): void => {
      if (!event.sender.isDestroyed()) event.sender.send('git-city:progress', p)
    }
    try {
      return await withRepoLock(repoPath, () => analyze(repoPath, send))
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
