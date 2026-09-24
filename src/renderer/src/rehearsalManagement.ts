import type { StateCreator } from 'zustand'
import type { RehearsalEntry, RehearsalInventory, RehearsalIdentity } from '../../shared/types'
import type { GitCityState } from './store'
import { bridge, cleanError } from './lib/bridge'

export function rememberRehearsal(repo: string, id: string): void {
  try {
    localStorage.setItem(`gitcity.rehearsal.current:${repo}`, id)
  } catch {
    /* Retention belongs to the CLI, never browser storage. */
  }
}
function remembered(repo: string): string | null {
  try {
    return localStorage.getItem(`gitcity.rehearsal.current:${repo}`)
  } catch {
    return null
  }
}

export interface RehearsalManagementState {
  rehearsalCurrent: Record<string, string>
  rehearsalInventories: Record<string, RehearsalInventory>
  rehearsalManagementMessages: Record<string, string>
  rehearsalExecutionRepo: string | null
  rehearsalStopping: boolean
  loadRehearsals(repo?: string, select?: boolean): Promise<void>
  selectRehearsal(repo: string, entry: RehearsalEntry): Promise<void>
  discardRehearsals(repo: string, entries: RehearsalIdentity[]): Promise<void>
  stopRehearsal(): Promise<void>
}

export const createRehearsalManagement: StateCreator<
  GitCityState,
  [],
  [],
  RehearsalManagementState
> = (set, get) => ({
  rehearsalCurrent: {},
  rehearsalInventories: {},
  rehearsalManagementMessages: {},
  rehearsalExecutionRepo: null,
  rehearsalStopping: false,
  loadRehearsals: async (repo = get().repoPath ?? undefined, select = true) => {
    const api = bridge()
    if (!repo || !api?.rehearsalList) return
    try {
      const inventory = await api.rehearsalList(repo)
      set((state) => ({
        rehearsalInventories: { ...state.rehearsalInventories, [repo]: inventory }
      }))
      if (select && !get().rehearsalBusy && !get().rehearsalRequest) {
        const result = get().rehearsalResults[repo]
        const id = result?.kind === 'report' ? result.report.id : remembered(inventory.repository)
        const entry = inventory.entries.find((entry) => entry.id === id) ?? inventory.entries[0]
        if (entry) await get().selectRehearsal(repo, entry)
        else
          set((state) => {
            const results = { ...state.rehearsalResults }
            delete results[repo]
            return { rehearsalResults: results }
          })
      }
    } catch (error) {
      set((state) => ({
        rehearsalManagementMessages: {
          ...state.rehearsalManagementMessages,
          [repo]: cleanError(error)
        }
      }))
    }
  },
  selectRehearsal: async (repo, entry) => {
    const api = bridge()
    if (!api || get().rehearsalBusy) return
    rememberRehearsal(entry.origin_worktree, entry.id)
    set((state) => ({
      rehearsalBusy: true,
      rehearsalCurrent: { ...state.rehearsalCurrent, [repo]: entry.id }
    }))
    try {
      const result = entry.active
        ? {
            kind: 'error' as const,
            message: `Rehearsal ${entry.id} is active in another process. Refresh after execution ends.`
          }
        : await api.rehearsalShow(entry)
      set((state) => {
        const old = state.rehearsalResults[repo]
        if (
          result.kind === 'report' &&
          old?.kind === 'report' &&
          old.report.id === result.report.id
        )
          result.report.plan = old.report.plan
        return {
          rehearsalResults: { ...state.rehearsalResults, [repo]: result },
          rehearsalRequest: null
        }
      })
    } catch (error) {
      set((state) => ({
        rehearsalResults: {
          ...state.rehearsalResults,
          [repo]: { kind: 'error', message: cleanError(error) }
        }
      }))
    } finally {
      set({ rehearsalBusy: false })
    }
  },
  discardRehearsals: async (repo, entries) => {
    const api = bridge()
    if (!api || get().rehearsalBusy) return
    set({ rehearsalBusy: true })
    try {
      const result = await api.rehearsalDiscard(repo, entries)
      const message = [
        `Discarded ${result.discarded.length} rehearsal(s).`,
        ...result.failures.map((failure) => `${failure.id}: ${failure.message}`)
      ].join(' ')
      set((state) => {
        const results = { ...state.rehearsalResults }
        const selected = results[repo]
        if (selected?.kind === 'report' && result.discarded.includes(selected.report.id))
          delete results[repo]
        return {
          rehearsalResults: results,
          rehearsalManagementMessages: { ...state.rehearsalManagementMessages, [repo]: message }
        }
      })
    } catch (error) {
      set((state) => ({
        rehearsalManagementMessages: {
          ...state.rehearsalManagementMessages,
          [repo]: cleanError(error)
        }
      }))
    } finally {
      set({ rehearsalBusy: false })
      await get().loadRehearsals(repo)
    }
  },
  stopRehearsal: async () => {
    const repo = get().rehearsalExecutionRepo
    const api = bridge()
    if (!repo || !api || get().rehearsalStopping) return
    set({ rehearsalStopping: true })
    try {
      const result = await api.rehearsalStop(repo)
      set((state) => ({
        rehearsalManagementMessages: {
          ...state.rehearsalManagementMessages,
          [repo]: result.message ?? 'Execution ended. Inspect retained state before continuing.'
        }
      }))
      await get().loadRehearsals(repo)
    } catch (error) {
      set((state) => ({
        rehearsalManagementMessages: {
          ...state.rehearsalManagementMessages,
          [repo]: cleanError(error)
        }
      }))
    } finally {
      set({ rehearsalStopping: false })
    }
  }
})
