import type { Choice } from './MergeView'

export interface RehearsalDraftSession {
  choices: Map<number, Choice>
  edits: Map<number, string>
  raw: string | null
  acknowledgements: string[]
  baseRevision: string
  baseContent: string
  hasLocalBuffer: boolean
  persistenceFailed: boolean
}

const sessions = new Map<string, RehearsalDraftSession>()

export function rehearsalDraftSessionKey(
  report: { repository: string; origin_worktree: string; repository_id: string; id: string },
  path: string
): string {
  return JSON.stringify([
    report.repository,
    report.origin_worktree,
    report.repository_id,
    report.id,
    path
  ])
}

export function getRehearsalDraftSession(
  key: string,
  baseRevision: string,
  baseContent: string
): RehearsalDraftSession {
  const existing = sessions.get(key)
  if (existing) return existing
  const created: RehearsalDraftSession = {
    choices: new Map(),
    edits: new Map(),
    raw: null,
    acknowledgements: [],
    baseRevision,
    baseContent,
    hasLocalBuffer: false,
    persistenceFailed: false
  }
  sessions.set(key, created)
  return created
}

export function clearRehearsalDraftSession(key: string): void {
  sessions.delete(key)
}

export function clearRehearsalDraftSessionsFor(report: {
  repository: string
  origin_worktree: string
  repository_id: string
  id: string
}): void {
  const prefix =
    JSON.stringify([
      report.repository,
      report.origin_worktree,
      report.repository_id,
      report.id
    ]).slice(0, -1) + ','
  for (const key of sessions.keys()) if (key.startsWith(prefix)) sessions.delete(key)
}

export function rehearsalDraftSessionsForTest(): ReadonlyMap<string, RehearsalDraftSession> {
  return sessions
}
