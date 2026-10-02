import { rehearsalComparisonKey } from '../../shared/rehearsalComparison'
import type { StateCreator } from 'zustand'
import type { RehearsalComparison, RehearsalReport } from '../../shared/types'
import type { GitCityState } from './store'
import { bridge, cleanError } from './lib/bridge'

export interface RehearsalComparisonState {
  rehearsalComparison: {
    report: RehearsalReport
    loading: boolean
    data?: RehearsalComparison
    error?: string
  } | null
  clearRehearsalComparison(): void
  compareRehearsal(report: RehearsalReport): Promise<void>
}

/** Only the selected, visible report may own the single active 3D canvas. */
export function hasRehearsalComparisonScene(state: GitCityState): boolean {
  const result = state.repoPath ? state.rehearsalResults[state.repoPath] : undefined
  return (
    state.rehearsalOpen &&
    !state.rehearsalBusy &&
    !!state.rehearsalComparison?.data &&
    result?.kind === 'report' &&
    result.report === state.rehearsalComparison.report
  )
}

export const createRehearsalComparison: StateCreator<
  GitCityState,
  [],
  [],
  RehearsalComparisonState
> = (set, get) => {
  let request = 0
  return {
    rehearsalComparison: null,
    clearRehearsalComparison: () => {
      request++
      set({ rehearsalComparison: null })
    },
    compareRehearsal: async (report) => {
      const api = bridge()
      const repo = get().repoPath
      if (!api || !repo || get().rehearsalBusy) return
      const token = ++request
      set({ playing: false, rehearsalComparison: { report, loading: true } })
      const current = (): boolean => {
        const result = get().rehearsalResults[repo]
        return (
          request === token &&
          get().repoPath === repo &&
          !get().rehearsalBusy &&
          result?.kind === 'report' &&
          result.report === report
        )
      }
      try {
        const data = await api.rehearsalComparison(report)
        if (!current()) return
        if (
          data.identity.id !== report.id ||
          data.identity.repository_id !== report.repository_id ||
          data.identity.origin_worktree !== report.origin_worktree ||
          data.identity.repository !== report.repository
        )
          throw new Error('Comparison belongs to a different rehearsal. Refresh the report.')
        if (data.reportKey !== rehearsalComparisonKey(report))
          throw new Error('Rehearsal changed. Refresh its report before comparing the city.')
        set({ rehearsalComparison: { report, loading: false, data } })
      } catch (error) {
        if (current())
          set({ rehearsalComparison: { report, loading: false, error: cleanError(error) } })
      } finally {
        if (request === token && !current()) set({ rehearsalComparison: null })
      }
    }
  }
}
