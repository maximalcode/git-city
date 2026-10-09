import { app } from 'electron'
import { join } from 'path'
import type {
  RehearsalDraftDiscardResult,
  RehearsalDraftPayload,
  RehearsalDraftListResult,
  RehearsalDraftReadResult,
  RehearsalDraftWriteResult,
  RehearsalIdentity
} from '../shared/types'
import {
  discardRehearsalDraft,
  discardRehearsalDraftsFor,
  hasRehearsalDrafts,
  listRehearsalDrafts,
  readRehearsalDraft,
  writeRehearsalDraft
} from './rehearsalDrafts'

const draftFile = (): string => join(app.getPath('userData'), 'rehearsal-drafts.json')

let inFlight = 0
const failedDrafts = new Set<string>()
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
  return failedDrafts.size > 0
}

async function tracked<T extends { status: string }>(
  operation: () => Promise<T>,
  draftKey: string,
  mutating = false
): Promise<T> {
  inFlight += 1
  try {
    const result = await operation()
    if (mutating) {
      if (result.status === 'error' || result.status === 'conflict' || result.status === 'unknown')
        failedDrafts.add(draftKey)
      else if (result.status === 'saved' || result.status === 'absent')
        failedDrafts.delete(draftKey)
    }
    return result
  } catch (error) {
    if (mutating) failedDrafts.add(draftKey)
    throw error
  } finally {
    inFlight -= 1
    if (inFlight === 0) {
      for (const resolve of waiters) resolve()
      waiters.clear()
    }
  }
}

function pendingKey(identity: RehearsalIdentity, path: string): string {
  return (
    JSON.stringify([
      identity.repository,
      identity.origin_worktree,
      identity.repository_id,
      identity.id
    ]) +
    '\0' +
    path
  )
}

export function rehearsalDraftRead(
  identity: RehearsalIdentity,
  path: string
): Promise<RehearsalDraftReadResult> {
  return tracked(() => readRehearsalDraft(draftFile(), identity, path), pendingKey(identity, path))
}

export function rehearsalDraftList(identity: RehearsalIdentity): Promise<RehearsalDraftListResult> {
  return tracked(() => listRehearsalDrafts(draftFile(), identity), pendingKey(identity, ''))
}

export function rehearsalDraftWrite(
  identity: RehearsalIdentity,
  path: string,
  payload: RehearsalDraftPayload,
  expectedDraftRevision: number | null
): Promise<RehearsalDraftWriteResult> {
  return tracked(
    () => writeRehearsalDraft(draftFile(), identity, path, payload, expectedDraftRevision),
    pendingKey(identity, path),
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
    pendingKey(identity, path),
    true
  )
}

export async function discardRehearsalDrafts(identity: RehearsalIdentity): Promise<void> {
  await discardRehearsalDraftsFor(draftFile(), identity)
  const prefix = pendingKey(identity, '')
  for (const key of failedDrafts) if (key.startsWith(prefix)) failedDrafts.delete(key)
}

export function rehearsalDraftsExist(identity: RehearsalIdentity): Promise<boolean> {
  return hasRehearsalDrafts(draftFile(), identity)
}
