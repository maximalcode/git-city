import { registerRehearsalDraftQuitBarrier } from './rehearsalDraftQuit'
import { compareRehearsal } from './rehearsalComparison'
import {
  rehearsalReviewFile,
  rehearsalReviewFiles,
  rehearsalReviewSummary
} from './rehearsalReview'
import { resolveRehearsalTool } from './rehearsalBundle'
import { inspectUndo, undoRehearsal } from './rehearsalUndo'
import { listRehearsals, discardRehearsals } from './rehearsalManagement'
import { stopRehearsal } from './rehearsalProcess'
import {
  readRehearsalConflict,
  saveRehearsalConflict,
  continueRehearsal,
  withRehearsal
} from './rehearsalConflicts'
import {
  rehearsalDraftDiscard,
  rehearsalDraftRead,
  rehearsalDraftList,
  rehearsalDraftWrite,
  rehearsalDraftsExist
} from './rehearsalDraftIpc'
import { applyRehearsal, inspectRecovery, recoverRehearsal } from './rehearsalRecovery'
import { withRepositoryWrite } from './repositoryQueue'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'path'
import { getRehearsalMode } from './rehearsalModeIpc'
import { rehearsalAvailability, rehearse, rehearseMerge, rehearsalShow } from './rehearsal'
import type {
  RehearsalPlan,
  RehearsalAction,
  RehearsalIdentity,
  RehearsalReport
} from '../shared/types'
import type { ProgressInfo } from '../shared/types'
import { analyze, checkGitInstalled } from './git/analyze'
import { cloneRepo } from './git/clone'
import { analysisFailedMessage } from './git/openErrors'
import { FriendlyError } from './git/result'
import { withRepoLock } from './git/queue'
import { registerOpsIpc } from './ipcOps'

export function registerIpc(): void {
  registerRehearsalDraftQuitBarrier()
  registerOpsIpc()
  ipcMain.handle('git-city:rehearsal-mode', (_event, repo, known, choice) =>
    getRehearsalMode(repo, known, choice)
  )

  // Deliberately outside the retrying mutation helper; never fall back to git merge.
  const rehearsalTool = (): string | undefined =>
    resolveRehearsalTool(app.isPackaged, process.resourcesPath)
  ipcMain.handle('git-city:rehearsal-availability', () =>
    rehearsalAvailability(resolveRehearsalTool(app.isPackaged, process.resourcesPath))
  )
  ipcMain.handle(
    'git-city:rehearse',
    (_event, repo: string, action: RehearsalAction, target: string, plan?: RehearsalPlan) =>
      rehearse(rehearsalTool(), repo, action, target, plan)
  )
  ipcMain.handle('git-city:rehearse-merge', (_event, repo: string, target: string) =>
    rehearseMerge(rehearsalTool(), repo, target)
  )
  ipcMain.handle('git-city:rehearsal-list', (_event, repo) => listRehearsals(rehearsalTool(), repo))
  ipcMain.handle('git-city:rehearsal-discard', (_event, repo, identities) =>
    discardRehearsals(rehearsalTool(), repo, identities)
  )
  ipcMain.handle('git-city:rehearsal-stop', (_event, repo) => stopRehearsal(repo))
  ipcMain.handle('git-city:rehearsal-comparison', (_event, identity: RehearsalIdentity) =>
    compareRehearsal(rehearsalTool(), identity)
  )
  ipcMain.handle('git-city:rehearsal-review-summary', (_event, identity: RehearsalIdentity) =>
    rehearsalReviewSummary(rehearsalTool(), identity)
  )
  ipcMain.handle(
    'git-city:rehearsal-review-files',
    (
      _event,
      identity: RehearsalIdentity,
      revision: string,
      scopeId: string,
      cursor?: string,
      filter?: string
    ) => rehearsalReviewFiles(rehearsalTool(), identity, revision, scopeId, cursor, filter)
  )
  ipcMain.handle(
    'git-city:rehearsal-review-file',
    (
      _event,
      identity: RehearsalIdentity,
      revision: string,
      scopeId: string,
      entryId: string,
      view
    ) => rehearsalReviewFile(rehearsalTool(), identity, revision, scopeId, entryId, view)
  )
  ipcMain.handle('git-city:rehearsal-show', (_event, identity: RehearsalIdentity) =>
    withRehearsal(identity, () => rehearsalShow(rehearsalTool(), identity))
  )

  ipcMain.handle('git-city:rehearsal-conflict-read', (_event, identity, path) =>
    readRehearsalConflict(rehearsalTool(), identity, path)
  )
  ipcMain.handle('git-city:rehearsal-conflict-save', (_event, identity, path, revision, text) =>
    saveRehearsalConflict(rehearsalTool(), identity, path, revision, text)
  )
  ipcMain.handle('git-city:rehearsal-draft-read', (_event, identity, path) =>
    rehearsalDraftRead(identity, path)
  )
  ipcMain.handle('git-city:rehearsal-draft-list', (_event, identity) =>
    rehearsalDraftList(identity)
  )
  ipcMain.handle(
    'git-city:rehearsal-draft-write',
    (_event, identity, path, payload, expectedDraftRevision) =>
      rehearsalDraftWrite(identity, path, payload, expectedDraftRevision)
  )
  ipcMain.handle(
    'git-city:rehearsal-draft-discard',
    (_event, identity, path, expectedDraftRevision) =>
      rehearsalDraftDiscard(identity, path, expectedDraftRevision)
  )
  ipcMain.handle('git-city:rehearsal-continue', (_event, identity: RehearsalReport) =>
    continueRehearsal(rehearsalTool(), identity, async () => {
      try {
        return (await rehearsalDraftsExist(identity))
          ? 'Resolve or discard the saved rehearsal editor draft before Continue.'
          : null
      } catch (error) {
        return error instanceof Error
          ? error.message
          : 'Saved rehearsal drafts could not be inspected before Continue.'
      }
    })
  )

  ipcMain.handle('git-city:rehearsal-undo-status', (_event, repo: string) =>
    withRepositoryWrite(repo, () => inspectUndo(rehearsalTool(), repo))
  )
  ipcMain.handle('git-city:rehearsal-undo', (_event, repo, identity) =>
    undoRehearsal(rehearsalTool(), repo, identity)
  )
  ipcMain.handle('git-city:rehearsal-apply', (_event, identity: RehearsalReport) =>
    withRehearsal(identity, async () => {
      try {
        if (await rehearsalDraftsExist(identity)) {
          const recovery = await inspectRecovery(rehearsalTool(), identity.origin_worktree)
          return {
            kind: 'refused' as const,
            message: 'Resolve or discard the saved rehearsal editor draft before Apply.',
            recovery
          }
        }
      } catch (error) {
        const recovery = await inspectRecovery(rehearsalTool(), identity.origin_worktree)
        return {
          kind: 'refused' as const,
          message:
            error instanceof Error
              ? error.message
              : 'Saved rehearsal drafts could not be inspected before Apply.',
          recovery
        }
      }
      return applyRehearsal(rehearsalTool(), identity)
    })
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
