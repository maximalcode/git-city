import type { StateCreator } from 'zustand'
import type {
  RehearsalEntry,
  RehearsalInventory,
  RehearsalIdentity,
  RehearsalResult
} from '../../shared/types'
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

/** Keep session-only plan annotations when the same retained report is refreshed. */
export function reconcileRehearsal(
  result: RehearsalResult,
  old?: RehearsalResult
): RehearsalResult {
  return result.kind === 'report' &&
    old?.kind === 'report' &&
    old.report.id === result.report.id &&
    old.report.origin_worktree === result.report.origin_worktree
    ? { ...result, report: { ...result.report, plan: old.report.plan } }
    : result
}

export interface RehearsalManagementState {
  rehearsalCurrent: Record<string, string>
  rehearsalInventories: Record<string, RehearsalInventory>
  rehearsalManagementMessages: Record<string, string>
  rehearsalExecutionRepo: string | null
  rehearsalStopping: boolean
  loadRehearsals(repo?: string, select?: boolean): Promise<RehearsalInventory | undefined>
  selectRehearsal(repo: string, entry: RehearsalEntry, isCurrent?: () => boolean): Promise<void>
  discardRehearsals(repo: string, entries: RehearsalIdentity[]): Promise<void>
  stopRehearsal(): Promise<void>
}

export const createRehearsalManagement: StateCreator<
  GitCityState,
  [],
  [],
  RehearsalManagementState
> = (set, get) => {
  const requests = new Map<string, symbol>()
  return {
    rehearsalCurrent: {},
    rehearsalInventories: {},
    rehearsalManagementMessages: {},
    rehearsalExecutionRepo: null,
    rehearsalStopping: false,
    loadRehearsals: async (repo = get().repoPath ?? undefined, select = true) => {
      const api = bridge()
      if (!repo || !api?.rehearsalList) return
      const request = Symbol()
      requests.set(repo, request)
      try {
        const inventory = await api.rehearsalList(repo)
        if (requests.get(repo) !== request) return
        set((state) => ({
          rehearsalInventories: { ...state.rehearsalInventories, [repo]: inventory }
        }))
        if (select && !get().rehearsalBusy && !get().rehearsalRequest) {
          const result = get().rehearsalResults[repo]
          const id = result?.kind === 'report' ? result.report.id : remembered(inventory.repository)
          const entry = inventory.entries.find((entry) => entry.id === id) ?? inventory.entries[0]
          if (
            entry &&
            !(
              result?.kind === 'report' &&
              result.report.id === entry.id &&
              result.report.outcome === entry.execution &&
              !entry.active
            )
          )
            await get().selectRehearsal(repo, entry, () => requests.get(repo) === request)
          else if (entry) return inventory
          else
            set((state) => {
              const results = { ...state.rehearsalResults }
              delete results[repo]
              return { rehearsalResults: results }
            })
        }
        return inventory
      } catch (error) {
        if (requests.get(repo) !== request) return
        set((state) => ({
          rehearsalManagementMessages: {
            ...state.rehearsalManagementMessages,
            [repo]: cleanError(error)
          }
        }))
        throw error
      } finally {
        if (requests.get(repo) === request) requests.delete(repo)
      }
    },
    selectRehearsal: async (repo, entry, isCurrent = () => true) => {
      const api = bridge()
      if (!api || get().rehearsalBusy) return
      get().clearRehearsalComparison()
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
        if (!isCurrent()) return
        set((state) => {
          return {
            rehearsalResults: {
              ...state.rehearsalResults,
              [repo]: reconcileRehearsal(result, state.rehearsalResults[repo])
            },
            rehearsalRequest: null
          }
        })
      } catch (error) {
        if (!isCurrent()) return
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
        await get()
          .loadRehearsals(repo)
          .catch(() => undefined)
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
        await get()
          .loadRehearsals(repo)
          .catch(() => undefined)
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
  }
}
