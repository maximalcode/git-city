import { create } from 'zustand'
import type { ProgressInfo, RepoAnalysis } from '../../shared/types'

export type ColorMode = 'language' | 'heat'

function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Electron prefixes IPC errors with "Error invoking remote method '...': Error:"
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

interface GitCityState {
  screen: 'welcome' | 'loading' | 'city'
  analysis: RepoAnalysis | null
  snapshotIndex: number
  playing: boolean
  hovered: string | null
  selected: string | null
  colorMode: ColorMode
  night: boolean
  progress: ProgressInfo | null
  error: string | null
  gitVersion: string | null | 'unknown'

  init(): void
  openLocal(): Promise<void>
  openUrl(url: string): Promise<void>
  setSnapshotIndex(i: number): void
  setPlaying(playing: boolean): void
  setHovered(path: string | null): void
  setSelected(path: string | null): void
  setColorMode(mode: ColorMode): void
  toggleNight(): void
  backToWelcome(): void
}

export const useStore = create<GitCityState>((set, get) => ({
  screen: 'welcome',
  analysis: null,
  snapshotIndex: 0,
  playing: false,
  hovered: null,
  selected: null,
  colorMode: 'language',
  night: false,
  progress: null,
  error: null,
  gitVersion: 'unknown',

  init: () => {
    // absent when the renderer runs in a plain browser (vite preview) instead of Electron
    if (!('gitCity' in window)) return
    window.gitCity.onProgress((p) => set({ progress: p }))
    window.gitCity
      .checkGit()
      .then((v) => set({ gitVersion: v }))
      .catch(() => set({ gitVersion: null }))
  },

  openLocal: async () => {
    const path = await window.gitCity.selectFolder()
    if (!path) return
    set({ screen: 'loading', error: null, progress: null })
    try {
      const analysis = await window.gitCity.analyzeRepo(path, 50)
      set({
        analysis,
        snapshotIndex: analysis.snapshots.length - 1,
        screen: 'city',
        selected: null,
        hovered: null,
        playing: false
      })
    } catch (err) {
      set({ screen: 'welcome', error: cleanError(err) })
    }
  },

  openUrl: async (url: string) => {
    set({ screen: 'loading', error: null, progress: null })
    try {
      const path = await window.gitCity.cloneRepo(url)
      const analysis = await window.gitCity.analyzeRepo(path, 50)
      set({
        analysis,
        snapshotIndex: analysis.snapshots.length - 1,
        screen: 'city',
        selected: null,
        hovered: null,
        playing: false
      })
    } catch (err) {
      set({ screen: 'welcome', error: cleanError(err) })
    }
  },

  setSnapshotIndex: (i) => set({ snapshotIndex: i, playing: false }),
  setPlaying: (playing) => {
    const { analysis, snapshotIndex } = get()
    // restart from the beginning when pressing play at the end
    if (playing && analysis && snapshotIndex >= analysis.snapshots.length - 1) {
      set({ playing, snapshotIndex: 0 })
    } else {
      set({ playing })
    }
  },
  setHovered: (hovered) => set({ hovered }),
  setSelected: (selected) => set({ selected }),
  setColorMode: (colorMode) => set({ colorMode }),
  toggleNight: () => set((s) => ({ night: !s.night })),
  backToWelcome: () =>
    set({ screen: 'welcome', analysis: null, selected: null, hovered: null, playing: false })
}))
