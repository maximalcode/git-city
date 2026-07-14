import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { resolve } from 'path'
import type { OpResult, ProgressInfo, RepoChangeReason } from '../shared/types'
import {
  cherryPick,
  cherryPickAbort,
  cherryPickContinue,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto
} from './git/advanced'
import { analyzeIncremental } from './git/analyze'
import { createBranch, deleteBranch, listBranches, switchBranch } from './git/branches'
import { commit, getLastCommitMessage } from './git/commit'
import { readConflictFile, resolveConflictFile, resolveWholeFile } from './git/conflicts'
import { mergeAbort, mergeBranch, mergeContinue } from './git/merge'
import { withRepoLock } from './git/queue'
import { failFromError } from './git/result'
import { discardFiles, stageFiles, unstageFiles } from './git/stage'
import { stashApply, stashDrop, stashList, stashPop, stashPush } from './git/stash'
import { getWorkingStatus } from './git/status'
import { cancelCurrentOp, fetchRemote, pullRemote, pushRemote } from './git/sync'
import { RepoWatcher } from './git/watcher'

const watcher = new RepoWatcher()
let watchedSender: WebContents | null = null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Every mutating op: serialized per repo, watcher muted while it runs (one
 * synthetic change event on unmute), thrown errors turned into OpResults,
 * and one automatic retry when an external git holds .git/index.lock.
 */
function mutating(
  channel: string,
  fn: (repoPath: string, ...args: never[]) => Promise<OpResult>
): void {
  ipcMain.handle(`git-city:${channel}`, (_event, repoPath: string, ...args: unknown[]) =>
    withRepoLock(repoPath, async () => {
      watcher.mute()
      try {
        let result = await fn(repoPath, ...(args as never[]))
        if (!result.ok && result.gitOutput?.includes('index.lock')) {
          await sleep(300)
          result = await fn(repoPath, ...(args as never[]))
        }
        return result
      } catch (err) {
        return failFromError(err)
      } finally {
        watcher.unmute()
      }
    })
  )
}

export function registerOpsIpc(): void {
  const emitChange = (reasons: RepoChangeReason[]): void => {
    if (watchedSender && !watchedSender.isDestroyed()) {
      watchedSender.send('git-city:repo-changed', reasons)
    }
  }

  // --- watcher ---
  ipcMain.handle('git-city:watch-start', async (event, repoPath: string) => {
    watchedSender = event.sender
    await watcher.start(repoPath, emitChange)
  })
  ipcMain.handle('git-city:watch-stop', () => {
    watcher.stop()
    watchedSender = null
  })

  // --- read-only ---
  ipcMain.handle('git-city:status', (_e, repoPath: string) => getWorkingStatus(repoPath))
  ipcMain.handle('git-city:branches', (_e, repoPath: string) => listBranches(repoPath))
  ipcMain.handle('git-city:stash-list', (_e, repoPath: string) => stashList(repoPath))
  ipcMain.handle('git-city:last-commit-message', (_e, repoPath: string) =>
    getLastCommitMessage(repoPath)
  )
  ipcMain.handle('git-city:conflict-read', (_e, repoPath: string, path: string) =>
    readConflictFile(repoPath, path)
  )
  ipcMain.handle('git-city:analyze-incremental', (_e, repoPath: string) =>
    withRepoLock(repoPath, () => analyzeIncremental(repoPath))
  )
  ipcMain.handle('git-city:open-in-editor', (_e, repoPath: string, path: string) => {
    const abs = resolve(repoPath, path)
    if (!abs.startsWith(resolve(repoPath))) return // never escape the repo
    void shell.openPath(abs)
  })

  // --- stage / commit ---
  mutating('stage', (repo, paths: string[]) => stageFiles(repo, paths))
  mutating('unstage', (repo, paths: string[]) => unstageFiles(repo, paths))
  mutating('discard', (repo, paths: string[]) => discardFiles(repo, paths))
  mutating('commit', (repo, message: string, amend: boolean) => commit(repo, message, amend))

  // --- sync (needs the sender for progress events) ---
  const progressTo =
    (sender: WebContents) =>
    (p: ProgressInfo): void => {
      if (!sender.isDestroyed()) sender.send('git-city:progress', p)
    }
  const syncOp = (
    channel: string,
    fn: (
      repoPath: string,
      onProgress: (p: ProgressInfo) => void,
      ...args: never[]
    ) => Promise<OpResult>
  ): void => {
    ipcMain.handle(`git-city:${channel}`, (event, repoPath: string, ...args: unknown[]) =>
      withRepoLock(repoPath, async () => {
        watcher.mute()
        try {
          return await fn(repoPath, progressTo(event.sender), ...(args as never[]))
        } catch (err) {
          return failFromError(err)
        } finally {
          watcher.unmute()
        }
      })
    )
  }
  syncOp('fetch', (repo, onP) => fetchRemote(repo, onP))
  syncOp('pull', (repo, onP) => pullRemote(repo, onP))
  syncOp('push', (repo, onP, setUpstream: boolean | undefined) =>
    pushRemote(repo, setUpstream ?? false, onP)
  )
  ipcMain.handle('git-city:cancel-op', () => cancelCurrentOp())

  // --- branches ---
  mutating('branch-switch', (repo, name: string) => switchBranch(repo, name))
  mutating('branch-create', (repo, name: string, andSwitch: boolean) =>
    createBranch(repo, name, andSwitch)
  )
  mutating('branch-delete', (repo, name: string, force: boolean) =>
    deleteBranch(repo, name, force)
  )

  // --- merge + conflicts ---
  mutating('merge', (repo, branch: string) => mergeBranch(repo, branch))
  mutating('merge-abort', (repo) => mergeAbort(repo))
  mutating('merge-continue', (repo) => mergeContinue(repo))
  mutating('conflict-resolve', (repo, path: string, text: string) =>
    resolveConflictFile(repo, path, text)
  )
  mutating('conflict-resolve-whole', (repo, path: string, side: 'ours' | 'theirs') =>
    resolveWholeFile(repo, path, side)
  )

  // --- stash ---
  mutating('stash-push', (repo, message: string, includeUntracked: boolean) =>
    stashPush(repo, message, includeUntracked)
  )
  mutating('stash-pop', (repo, index: number) => stashPop(repo, index))
  mutating('stash-apply', (repo, index: number) => stashApply(repo, index))
  mutating('stash-drop', (repo, index: number) => stashDrop(repo, index))

  // --- advanced ---
  mutating('cherry-pick', (repo, hash: string) => cherryPick(repo, hash))
  mutating('cherry-pick-continue', (repo) => cherryPickContinue(repo))
  mutating('cherry-pick-abort', (repo) => cherryPickAbort(repo))
  mutating('rebase', (repo, onto: string) => rebaseOnto(repo, onto))
  mutating('rebase-continue', (repo) => rebaseContinue(repo))
  mutating('rebase-abort', (repo) => rebaseAbort(repo))
}
