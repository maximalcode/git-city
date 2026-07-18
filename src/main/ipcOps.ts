import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { resolve, sep } from 'path'
import type {
  HunkMode,
  OpResult,
  ProgressInfo,
  RebaseEntry,
  RepoChangeReason,
  ResetMode
} from '../shared/types'
import {
  cherryPick,
  cherryPickAbort,
  cherryPickContinue,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto
} from './git/advanced'
import { analyzeIncremental } from './git/analyze'
import { getFileDiff } from './git/diff'
import { applyHunk, getFileHunks } from './git/hunks'
import { commitGraph } from './git/graph'
import { blameFile, fileHistory } from './git/history'
import { getReflog, recoverToBranch, resetTo } from './git/reflog'
import { createTag, deleteTag, listTags } from './git/tags'
import { getRebaseTodo, runInteractiveRebase } from './git/rebaseInteractive'
import { createBranch, deleteBranch, listBranches, switchBranch } from './git/branches'
import { commit, getLastCommitMessage } from './git/commit'
import { readConflictFile, resolveConflictFile, resolveWholeFile } from './git/conflicts'
import { mergeAbort, mergeBranch, mergeContinue } from './git/merge'
import { withRepoLock } from './git/queue'
import { FriendlyError, failFromError } from './git/result'
import { discardFiles, stageFiles, unstageFiles } from './git/stage'
import { stashApply, stashDrop, stashList, stashPop, stashPush } from './git/stash'
import { getWorkingStatus } from './git/status'
import { cancelCurrentOp, fetchRemote, pullRemote, pushRemote } from './git/sync'
import { RepoWatcher } from './git/watcher'

const watcher = new RepoWatcher()
let watchedSender: WebContents | null = null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Read-only channels: log the real failure in the main process, but surface a
 * clean generic message to the renderer — raw git stderr routinely contains
 * absolute paths and repo internals that don't belong in the UI.
 */
function readOnly<T>(
  channel: string,
  fn: (repoPath: string, ...args: never[]) => Promise<T> | T
): void {
  ipcMain.handle(`git-city:${channel}`, async (_event, repoPath: string, ...args: unknown[]) => {
    try {
      return await fn(repoPath, ...(args as never[]))
    } catch (err) {
      if (err instanceof FriendlyError) throw new Error(err.message)
      console.error(`[git-city] ${channel} failed:`, err)
      throw new Error(`Could not load ${channel.replace(/-/g, ' ')}.`)
    }
  })
}

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
  readOnly('status', (repo) => getWorkingStatus(repo))
  readOnly('branches', (repo) => listBranches(repo))
  readOnly('stash-list', (repo) => stashList(repo))
  readOnly('last-commit-message', (repo) => getLastCommitMessage(repo))
  readOnly('conflict-read', (repo, path: string) => readConflictFile(repo, path))
  readOnly('diff', (repo, path: string, rev?: string) =>
    getFileDiff(repo, path, rev ? { rev } : {})
  )
  readOnly('file-hunks', (repo, path: string, staged: boolean) => getFileHunks(repo, path, staged))
  readOnly('file-history', (repo, path: string) => fileHistory(repo, path))
  readOnly('blame', (repo, path: string, rev?: string) => blameFile(repo, path, rev))
  readOnly('commit-graph', (repo, limit?: number) => commitGraph(repo, limit ?? 500))
  readOnly('reflog', (repo, limit?: number) => getReflog(repo, limit ?? 100))
  readOnly('tags', (repo) => listTags(repo))
  readOnly('rebase-todo', (repo, count: number) => getRebaseTodo(repo, count))
  ipcMain.handle('git-city:analyze-incremental', (_e, repoPath: string) =>
    withRepoLock(repoPath, () => analyzeIncremental(repoPath))
  )
  ipcMain.handle('git-city:open-in-editor', (_e, repoPath: string, path: string) => {
    const root = resolve(repoPath)
    const abs = resolve(root, path)
    // never escape the repo — a bare prefix check would admit sibling dirs
    // like C:\repo-evil for C:\repo, so require the separator (or the root itself)
    if (abs !== root && !abs.startsWith(root + sep)) return
    void shell.openPath(abs)
  })

  // --- stage / commit ---
  mutating('stage', (repo, paths: string[]) => stageFiles(repo, paths))
  mutating('unstage', (repo, paths: string[]) => unstageFiles(repo, paths))
  mutating('discard', (repo, paths: string[]) => discardFiles(repo, paths))
  mutating('apply-hunk', (repo, path: string, header: string, mode: HunkMode) =>
    applyHunk(repo, path, header, mode)
  )
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
  mutating('branch-delete', (repo, name: string, force: boolean) => deleteBranch(repo, name, force))

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

  // --- tags + interactive rebase ---
  mutating('tag-create', (repo, name: string, ref?: string) => createTag(repo, name, ref))
  mutating('tag-delete', (repo, name: string) => deleteTag(repo, name))
  mutating('rebase-interactive', (repo, base: string | null, entries: RebaseEntry[]) =>
    runInteractiveRebase(repo, base, entries)
  )

  // --- reflog (undo / recover) ---
  mutating('reset-to', (repo, ref: string, mode: ResetMode) => resetTo(repo, ref, mode))
  mutating('reflog-recover', (repo, name: string, ref: string) => recoverToBranch(repo, name, ref))
}
