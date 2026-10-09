import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { withRehearsal } from './rehearsalConflicts'
import type { RehearsalDraftPayload, RehearsalIdentity } from '../shared/types'

const electronState = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronState.userData } }))

import {
  rehearsalDraftRead,
  rehearsalDraftWrite,
  rehearsalDraftDiscard,
  rehearsalDraftsExist,
  rehearsalDraftPersistenceFailed,
  rehearsalDraftWritesPending,
  waitForRehearsalDraftWrites
} from './rehearsalDraftIpc'

const identity: RehearsalIdentity = {
  id: 'ipc-rehearsal',
  repository: '',
  origin_worktree: '',
  repository_id: 'ipc-repository'
}
const draft: RehearsalDraftPayload = {
  base_revision: 'sandbox-1',
  base_content: 'ours\ntheirs\n',
  mode: 'whole-file',
  whole_file_text: 'resolved in the editor\n',
  choices: {},
  edits: {},
  acknowledged_hunks: []
}

describe('rehearsal draft bridge adapter', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('uses the application-owned store through read/write/discard bridge operations', async () => {
    root = await mkdtemp(join(tmpdir(), 'city-draft-ipc-'))
    const repository = join(root, 'repository')
    const origin = join(root, 'origin')
    await Promise.all([writeFile(repository, ''), writeFile(origin, '')])
    electronState.userData = root
    const scopedIdentity = { ...identity, repository, origin_worktree: origin }
    const written = await rehearsalDraftWrite(scopedIdentity, 'conflict.txt', draft, null)
    expect(written.status).toBe('saved')
    expect(await rehearsalDraftsExist(scopedIdentity)).toBe(true)
    const read = await rehearsalDraftRead(scopedIdentity, 'conflict.txt')
    expect(read.record?.whole_file_text).toBe('resolved in the editor\n')
    const removed = await rehearsalDraftDiscard(
      scopedIdentity,
      'conflict.txt',
      written.record!.draft_revision
    )
    expect(removed.status).toBe('absent')
    expect((await rehearsalDraftRead(scopedIdentity, 'conflict.txt')).status).toBe('absent')
    expect(await rehearsalDraftsExist(scopedIdentity)).toBe(false)
  })

  it('counts writes waiting for rehearsal ownership in the native quit barrier', async () => {
    root = await mkdtemp(join(tmpdir(), 'city-draft-ipc-'))
    electronState.userData = root
    const scopedIdentity = { ...identity, repository: root, origin_worktree: root }
    let release!: () => void
    let entered!: () => void
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = withRehearsal(scopedIdentity, async () => {
      entered()
      await barrier
    })
    await enteredPromise
    const storage = await import('./rehearsalDrafts')
    const publish = vi.spyOn(storage, 'writeRehearsalDraft')
    const pending = rehearsalDraftWrite(scopedIdentity, 'queued.txt', draft, null)
    let drained = false
    const quit = waitForRehearsalDraftWrites().then(() => {
      drained = true
    })
    try {
      expect(rehearsalDraftWritesPending()).toBe(true)
      expect(publish).not.toHaveBeenCalled()
      await Promise.resolve()
      expect(drained).toBe(false)
    } finally {
      release()
      await held
      expect((await pending).status).toBe('saved')
      await quit
      publish.mockRestore()
    }
    expect(rehearsalDraftWritesPending()).toBe(false)
    expect((await rehearsalDraftRead(scopedIdentity, 'queued.txt')).record?.whole_file_text).toBe(
      draft.whole_file_text
    )
  })

  it('keeps a failed draft pending when a different file saves successfully', async () => {
    root = await mkdtemp(join(tmpdir(), 'city-draft-ipc-'))
    electronState.userData = root
    const scopedIdentity = { ...identity, repository: root, origin_worktree: root }
    expect((await rehearsalDraftWrite(scopedIdentity, 'failed.txt', draft, 0)).status).toBe('error')
    expect(rehearsalDraftPersistenceFailed()).toBe(true)
    expect((await rehearsalDraftWrite(scopedIdentity, 'other.txt', draft, null)).status).toBe(
      'saved'
    )
    expect(rehearsalDraftPersistenceFailed()).toBe(true)
    await rehearsalDraftDiscard(scopedIdentity, 'failed.txt', null)
    expect(rehearsalDraftPersistenceFailed()).toBe(false)
  })
})
