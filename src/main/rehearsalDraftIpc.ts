import { app } from 'electron'
import { join } from 'path'
import type {
  RehearsalDraftDiscardResult,
  RehearsalDraftPayload,
  RehearsalDraftReadResult,
  RehearsalDraftWriteResult,
  RehearsalIdentity
} from '../shared/types'
import {
  discardRehearsalDraft,
  discardRehearsalDraftsFor,
  hasRehearsalDrafts,
  readRehearsalDraft,
  writeRehearsalDraft
} from './rehearsalDrafts'

const draftFile = (): string => join(app.getPath('userData'), 'rehearsal-drafts.json')

let inFlight = 0
let persistenceFailed = false
const waiters = new Set<() => void>()

/** Main-process quit barrier: requests already admitted by IPC finish durably. */
export function waitForRehearsalDraftWrites(): Promise<void> {
  if (inFlight === 0) return Promise.resolve()
  return new Promise((resolve) => waiters.add(resolve))
}

export function rehearsalDraftWritesPending(): boolean {
  return inFlight > 0
}

export function rehearsalDraftPersistenceFailed(): boolean {
  return persistenceFailed
}

async function tracked<T extends { status: string }>(
  operation: () => Promise<T>,
  mutating = false
): Promise<T> {
  inFlight += 1
  try {
    const result = await operation()
    if (mutating) {
      if (result.status === 'error' || result.status === 'conflict' || result.status === 'unknown')
        persistenceFailed = true
      else if (result.status === 'saved' || result.status === 'absent') persistenceFailed = false
    }
    return result
  } catch (error) {
    persistenceFailed = true
    throw error
  } finally {
    inFlight -= 1
    if (inFlight === 0) {
      for (const resolve of waiters) resolve()
      waiters.clear()
    }
  }
}

export function rehearsalDraftRead(
  identity: RehearsalIdentity,
  path: string
): Promise<RehearsalDraftReadResult> {
  return tracked(() => readRehearsalDraft(draftFile(), identity, path))
}

export function rehearsalDraftWrite(
  identity: RehearsalIdentity,
  path: string,
  payload: RehearsalDraftPayload,
  expectedDraftRevision: number | null
): Promise<RehearsalDraftWriteResult> {
  return tracked(
    () => writeRehearsalDraft(draftFile(), identity, path, payload, expectedDraftRevision),
    true
  )
}

export function rehearsalDraftDiscard(
  identity: RehearsalIdentity,
  path: string,
  expectedDraftRevision: number | null
): Promise<RehearsalDraftDiscardResult> {
  return tracked(
    () => discardRehearsalDraft(draftFile(), identity, path, expectedDraftRevision),
    true
  )
}

export function discardRehearsalDrafts(identity: RehearsalIdentity): Promise<void> {
  return discardRehearsalDraftsFor(draftFile(), identity)
}

export function rehearsalDraftsExist(identity: RehearsalIdentity): Promise<boolean> {
  return hasRehearsalDrafts(draftFile(), identity)
}
