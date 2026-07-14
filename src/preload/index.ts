import { contextBridge, ipcRenderer } from 'electron'
import type { GitCityApi, ProgressInfo, RepoChangeReason } from '../shared/types'

const api: GitCityApi = {
  checkGit: () => ipcRenderer.invoke('git-city:check-git'),
  selectFolder: () => ipcRenderer.invoke('git-city:select-folder'),
  analyzeRepo: (repoPath, samples) => ipcRenderer.invoke('git-city:analyze', repoPath, samples),
  analyzeIncremental: (repoPath) => ipcRenderer.invoke('git-city:analyze-incremental', repoPath),
  cloneRepo: (url) => ipcRenderer.invoke('git-city:clone', url),
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ProgressInfo): void => cb(p)
    ipcRenderer.on('git-city:progress', listener)
    return () => ipcRenderer.removeListener('git-city:progress', listener)
  },

  // --- live repo state ---
  status: (repoPath) => ipcRenderer.invoke('git-city:status', repoPath),
  watchStart: (repoPath) => ipcRenderer.invoke('git-city:watch-start', repoPath),
  watchStop: () => ipcRenderer.invoke('git-city:watch-stop'),
  onRepoChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, reasons: RepoChangeReason[]): void =>
      cb(reasons)
    ipcRenderer.on('git-city:repo-changed', listener)
    return () => ipcRenderer.removeListener('git-city:repo-changed', listener)
  },

  // --- stage / commit ---
  stage: (repoPath, paths) => ipcRenderer.invoke('git-city:stage', repoPath, paths),
  unstage: (repoPath, paths) => ipcRenderer.invoke('git-city:unstage', repoPath, paths),
  discard: (repoPath, paths) => ipcRenderer.invoke('git-city:discard', repoPath, paths),
  commit: (repoPath, message, amend) =>
    ipcRenderer.invoke('git-city:commit', repoPath, message, amend),
  lastCommitMessage: (repoPath) => ipcRenderer.invoke('git-city:last-commit-message', repoPath),

  // --- sync ---
  fetch: (repoPath) => ipcRenderer.invoke('git-city:fetch', repoPath),
  pull: (repoPath) => ipcRenderer.invoke('git-city:pull', repoPath),
  push: (repoPath, setUpstream) => ipcRenderer.invoke('git-city:push', repoPath, setUpstream),
  cancelOp: () => ipcRenderer.invoke('git-city:cancel-op'),

  // --- branches ---
  branches: (repoPath) => ipcRenderer.invoke('git-city:branches', repoPath),
  switchBranch: (repoPath, name) => ipcRenderer.invoke('git-city:branch-switch', repoPath, name),
  createBranch: (repoPath, name, andSwitch) =>
    ipcRenderer.invoke('git-city:branch-create', repoPath, name, andSwitch),
  deleteBranch: (repoPath, name, force) =>
    ipcRenderer.invoke('git-city:branch-delete', repoPath, name, force),

  // --- merge + conflicts ---
  merge: (repoPath, branch) => ipcRenderer.invoke('git-city:merge', repoPath, branch),
  mergeAbort: (repoPath) => ipcRenderer.invoke('git-city:merge-abort', repoPath),
  mergeContinue: (repoPath) => ipcRenderer.invoke('git-city:merge-continue', repoPath),
  conflictRead: (repoPath, path) => ipcRenderer.invoke('git-city:conflict-read', repoPath, path),
  conflictResolve: (repoPath, path, text) =>
    ipcRenderer.invoke('git-city:conflict-resolve', repoPath, path, text),
  conflictResolveWhole: (repoPath, path, side) =>
    ipcRenderer.invoke('git-city:conflict-resolve-whole', repoPath, path, side),
  openInEditor: (repoPath, path) =>
    ipcRenderer.invoke('git-city:open-in-editor', repoPath, path),

  // --- stash ---
  stashList: (repoPath) => ipcRenderer.invoke('git-city:stash-list', repoPath),
  stashPush: (repoPath, message, includeUntracked) =>
    ipcRenderer.invoke('git-city:stash-push', repoPath, message, includeUntracked),
  stashPop: (repoPath, index) => ipcRenderer.invoke('git-city:stash-pop', repoPath, index),
  stashApply: (repoPath, index) => ipcRenderer.invoke('git-city:stash-apply', repoPath, index),
  stashDrop: (repoPath, index) => ipcRenderer.invoke('git-city:stash-drop', repoPath, index),

  // --- advanced ---
  cherryPick: (repoPath, hash) => ipcRenderer.invoke('git-city:cherry-pick', repoPath, hash),
  cherryPickContinue: (repoPath) => ipcRenderer.invoke('git-city:cherry-pick-continue', repoPath),
  cherryPickAbort: (repoPath) => ipcRenderer.invoke('git-city:cherry-pick-abort', repoPath),
  rebase: (repoPath, onto) => ipcRenderer.invoke('git-city:rebase', repoPath, onto),
  rebaseContinue: (repoPath) => ipcRenderer.invoke('git-city:rebase-continue', repoPath),
  rebaseAbort: (repoPath) => ipcRenderer.invoke('git-city:rebase-abort', repoPath)
}

contextBridge.exposeInMainWorld('gitCity', api)
