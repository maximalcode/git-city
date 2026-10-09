import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { RehearsalDraftPayload, RehearsalIdentity } from '../shared/types'

const electronState = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronState.userData } }))

import {
  rehearsalDraftRead,
  rehearsalDraftWrite,
  rehearsalDraftDiscard,
  rehearsalDraftsExist,
  rehearsalDraftPersistenceFailed
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
