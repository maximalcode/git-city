import { app, ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { basename, resolve, sep } from 'path'
import type {
  CommitSearchScope,
  HunkMode,
  OpResult,
  PrFilesResult,
  PrListResult,
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
import { repoSize } from './git/analyze'
import { getFileDiff } from './git/diff'
import { imageDiff } from './git/images'
import { applyHunk, applyLines, getFileHunks } from './git/hunks'
import { commitGraph } from './git/graph'
import { blameFile, fileHistory } from './git/history'
import { commitDetail, grepWorkingTree, searchCommits } from './git/search'
import { getReflog, recoverToBranch, resetTo } from './git/reflog'
import { createTag, deleteTag, listTags } from './git/tags'
import { getRebaseTodo, runInteractiveRebase } from './git/rebaseInteractive'
import { createBranch, deleteBranch, listBranches, switchBranch } from './git/branches'
import { commit, getLastCommitMessage } from './git/commit'
import { getSigningConfig } from './git/signing'
import { probeHost, providerFor, unknownHostAuth } from './git/host'
import { listSubmodules, updateSubmodules } from './git/submodules'
import { addWorktree, listWorktrees, removeWorktree } from './git/worktrees'
import { checkForUpdate } from './updates'
import { readConflictFile, resolveConflictFile, resolveWholeFile } from './git/conflicts'
import { mergeAbort, mergeBranch, mergeContinue } from './git/merge'
import { withRepoLock } from './git/queue'
import { FriendlyError, failFromError, stripNoise } from './git/result'
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
      // "Could not load blame." next to a Retry that loops was every reason a
      // read can fail. git usually said something useful — pass its first line
      // on, with absolute paths reduced to a basename so the panel doesn't
      // become a directory listing (#30).
      const detail = gitDetail(err, repoPath)
      throw new Error(
        detail
          ? `Could not load ${channel.replace(/-/g, ' ')}: ${detail}`
          : `Could not load ${channel.replace(/-/g, ' ')}.`
      )
    }
  })
}

/**
 * git's own first line, safe to show. Returns null when there is nothing worth
 * adding — an internal stack, or a message that is just our own command line.
 */
function gitDetail(err: unknown, repoPath: string): string | null {
  if (!(err instanceof Error)) return null
  const line = stripNoise(err.message)[0]
  if (!line) return null
  // Our own failure text ("git log --first-parent … exited with 128") tells the
  // user nothing and exposes the invocation; the console.error above keeps it.
  if (/^git\s.*exited with/.test(line)) return null
  const short = line.split(repoPath).join(basename(repoPath))
  return short.length > 200 ? `${short.slice(0, 199)}…` : short
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
  readOnly('signing-config', (repo) => getSigningConfig(repo))
  readOnly('submodules', (repo) => listSubmodules(repo))
  readOnly('worktrees', (repo) => listWorktrees(repo))
  readOnly('repo-size', (repo) => repoSize(repo))
  // The probe's own answer is used when nobody claims the repo, so a missing
  // CLI says so instead of being reported as "no GitHub or GitLab remote" (#24).
  readOnly('host-status', async (repo) => {
    const { provider, auth } = await probeHost(repo)
    return provider ? provider.status(repo) : (auth ?? unknownHostAuth())
  })
  readOnly(
    'pr-list',
    async (repo): Promise<PrListResult> =>
      (await providerFor(repo))?.listPullRequests(repo) ?? {
        ok: true,
        prs: [],
        more: false
      }
  )
  readOnly('pr-current', async (repo) => (await providerFor(repo))?.currentBranchPr(repo) ?? null)
  readOnly(
    'pr-files',
    async (repo, number: number): Promise<PrFilesResult> =>
      (await providerFor(repo))?.pullRequestFiles(repo, number) ?? {
        ok: false,
        reason: unknownHostAuth().reason ?? 'No pull-request host for this repository.'
      }
  )
  ipcMain.handle('git-city:open-external', (_e, url: string) => {
    // only ever open https links (URLs come from gh's own JSON output)
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
  })
  // app-scoped (no repo): ask GitHub Releases whether a newer version exists
  ipcMain.handle('git-city:check-update', () => checkForUpdate(app.getVersion()))
  // PR create is network-only (no working-tree mutation); its errors already
  // come back as OpResult, so a plain handle is enough
  ipcMain.handle(
    'git-city:pr-create',
    async (_e, repo: string, base: string, title: string, body: string) => {
      const provider = await providerFor(repo)
      return provider
        ? provider.createPr(repo, base, title, body)
        : { ok: false, code: 'unknown', message: unknownHostAuth().reason }
    }
  )
  readOnly('conflict-read', (repo, path: string) => readConflictFile(repo, path))
  readOnly('diff', (repo, path: string, rev?: string) =>
    getFileDiff(repo, path, rev ? { rev } : {})
  )
  readOnly('image-diff', (repo, path: string, rev?: string) => imageDiff(repo, path, rev))
  readOnly('file-hunks', (repo, path: string, staged: boolean) => getFileHunks(repo, path, staged))
  readOnly('file-history', (repo, path: string) => fileHistory(repo, path))
  readOnly('blame', (repo, path: string, rev?: string) => blameFile(repo, path, rev))
  readOnly('commit-graph', (repo, limit?: number) => commitGraph(repo, limit ?? 500))
  readOnly('search-commits', (repo, query: string, scope: CommitSearchScope) =>
    searchCommits(repo, query, scope)
  )
  readOnly('grep-tree', (repo, query: string) => grepWorkingTree(repo, query))
  readOnly('commit-detail', (repo, hash: string) => commitDetail(repo, hash))
  readOnly('reflog', (repo, limit?: number) => getReflog(repo, limit ?? 100))
  readOnly('tags', (repo) => listTags(repo))
  readOnly('rebase-todo', (repo, count: number) => getRebaseTodo(repo, count))
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
  mutating(
    'apply-lines',
    (repo, path: string, header: string, lineIndices: number[], mode: HunkMode) =>
      applyLines(repo, path, header, lineIndices, mode)
  )
  mutating('commit', (repo, message: string, amend: boolean, sign?: boolean) =>
    commit(repo, message, amend, sign)
  )
  mutating('pr-checkout', async (repo, number: number) => {
    const provider = await providerFor(repo)
    return provider
      ? provider.checkoutPr(repo, number)
      : { ok: false, code: 'unknown' as const, message: unknownHostAuth().reason ?? '' }
  })
  mutating('submodule-update', (repo, path?: string) => updateSubmodules(repo, path))
  mutating('worktree-add', (repo, path: string, ref: string) => addWorktree(repo, path, ref))
  mutating('worktree-remove', (repo, path: string, force: boolean) =>
    removeWorktree(repo, path, force)
  )

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
