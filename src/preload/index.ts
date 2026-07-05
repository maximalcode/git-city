import { contextBridge, ipcRenderer } from 'electron'
import type { GitCityApi, ProgressInfo } from '../shared/types'

const api: GitCityApi = {
  checkGit: () => ipcRenderer.invoke('git-city:check-git'),
  selectFolder: () => ipcRenderer.invoke('git-city:select-folder'),
  analyzeRepo: (repoPath, samples) => ipcRenderer.invoke('git-city:analyze', repoPath, samples),
  cloneRepo: (url) => ipcRenderer.invoke('git-city:clone', url),
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ProgressInfo): void => cb(p)
    ipcRenderer.on('git-city:progress', listener)
    return () => ipcRenderer.removeListener('git-city:progress', listener)
  }
}

contextBridge.exposeInMainWorld('gitCity', api)
