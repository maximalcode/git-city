import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { RehearsalDraftPayload, RehearsalIdentity } from '../shared/types'
import {
  discardRehearsalDraft,
  discardRehearsalDraftsFor,
  readRehearsalDraft,
  writeRehearsalDraft
} from './rehearsalDrafts'

const cleanup: string[] = []
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true })
})

const payload = (baseRevision: string, text: string): RehearsalDraftPayload => ({
  base_revision: baseRevision,
  base_content: 'ours\ntheirs\n',
  mode: 'whole-file',
  whole_file_text: text,
  choices: {},
  edits: {},
  acknowledged_hunks: []
})

async function fixture(): Promise<{ file: string; identity: RehearsalIdentity; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'city-drafts-'))
  cleanup.push(root)
  const origin = join(root, 'origin')
  const repository = join(root, 'repository')
  await Promise.all([writeFile(origin, ''), writeFile(repository, '')])
  return {
    root,
    file: join(root, 'state', 'rehearsal-drafts.json'),
    identity: {
      id: 'rehearsal-1',
      repository,
      origin_worktree: origin,
      repository_id: 'repo-1'
    }
  }
}

describe('rehearsal draft persistence', () => {
  it('round-trips independent identity/path records and requires exact revisions', async () => {
    const first = await fixture()
    const second = { ...first.identity, id: 'rehearsal-2' }
    const firstWrite = await writeRehearsalDraft(
      first.file,
      first.identity,
      'one.txt',
      payload('base-one', 'first draft'),
      null
    )
    expect(firstWrite.status).toBe('saved')
    const secondWrite = await writeRehearsalDraft(
      first.file,
      second,
      'one.txt',
      payload('base-two', 'second draft'),
      null
    )
    expect(secondWrite.status).toBe('saved')
    const one = await readRehearsalDraft(first.file, first.identity, 'one.txt')
    const two = await readRehearsalDraft(first.file, second, 'one.txt')
    expect(one.record?.whole_file_text).toBe('first draft')
    expect(two.record?.whole_file_text).toBe('second draft')
    expect(
      await writeRehearsalDraft(
        first.file,
        first.identity,
        'one.txt',
        payload('base-one', 'late'),
        null
      )
    ).toMatchObject({ status: 'conflict', record: { whole_file_text: 'first draft' } })
    expect(await discardRehearsalDraft(first.file, first.identity, 'one.txt', 99)).toMatchObject({
      status: 'conflict',
      draft_revision: 1
    })
  })

  it('keeps the previous valid snapshot and reports incompatible current data', async () => {
    const { file, identity } = await fixture()
    const saved = await writeRehearsalDraft(
      file,
      identity,
      'file.txt',
      payload('revision-1', 'durable'),
      null
    )
    expect(saved.status).toBe('saved')
    await writeFile(file, '{ this is not a draft store }')
    const restored = await readRehearsalDraft(file, identity, 'file.txt')
    expect(restored.status).toBe('unknown')
    expect(restored.record?.whole_file_text).toBe('durable')
    expect(restored.message).toMatch(/previous valid/i)
    const raw = JSON.parse(await readFile(file + '.previous', 'utf8')) as { records: unknown[] }
    expect(raw.records).toHaveLength(1)
  })

  it('reports an inaccessible store without inventing a draft', async () => {
    const { file, identity } = await fixture()
    const saved = await writeRehearsalDraft(
      file,
      identity,
      'file.txt',
      payload('revision-1', 'durable'),
      null
    )
    expect(saved.status).toBe('saved')
    const failure = await writeRehearsalDraft(
      join(file, 'a-directory'),
      identity,
      'file.txt',
      payload('revision-1', 'not durable'),
      null
    )
    expect(failure.status).toBe('error')
    expect(failure.record).toBeNull()
  })

  it('clears only drafts belonging to a successfully discarded rehearsal', async () => {
    const first = await fixture()
    const second = { ...first.identity, id: 'rehearsal-2' }
    await writeRehearsalDraft(first.file, first.identity, 'one.txt', payload('a', 'first'), null)
    await writeRehearsalDraft(first.file, first.identity, 'two.txt', payload('a', 'second'), null)
    await writeRehearsalDraft(first.file, second, 'one.txt', payload('b', 'other'), null)
    await discardRehearsalDraftsFor(first.file, first.identity)
    expect((await readRehearsalDraft(first.file, first.identity, 'one.txt')).status).toBe('absent')
    expect((await readRehearsalDraft(first.file, first.identity, 'two.txt')).status).toBe('absent')
    expect((await readRehearsalDraft(first.file, second, 'one.txt')).record?.whole_file_text).toBe(
      'other'
    )
  })
})
