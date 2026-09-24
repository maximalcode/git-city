import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, chmod, statfs } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGit } from './git/exec'
import { rehearseMerge, rehearsalShow, runRehearsalTool } from './rehearsal'
import { listRehearsals, discardRehearsals } from './rehearsalManagement'
import { stopRehearsal } from './rehearsalProcess'

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, statfs: vi.fn(actual.statfs) }
})

const tool = process.env.GIT_CITY_REHEARSE_BIN
let root: string
let repo: string
async function fixture(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'git-city-management-'))
  repo = join(root, 'repo')
  vi.stubEnv('GIT_REHEARSE_CACHE_DIR', join(root, 'cache'))
  await runGit(root, ['init', '-b', 'main', repo])
  for (const [key, value] of [
    ['user.name', 'Test'],
    ['user.email', 'test@example.invalid'],
    ['commit.gpgSign', 'false']
  ])
    await runGit(repo, ['config', key, value])
  await writeFile(join(repo, 'file.txt'), 'base\n')
  await runGit(repo, ['add', '.'])
  await runGit(repo, ['commit', '-m', 'base'])
  await runGit(repo, ['checkout', '-b', 'topic'])
  await writeFile(join(repo, 'file.txt'), 'topic\n')
  await runGit(repo, ['commit', '-am', 'topic'])
  await runGit(repo, ['checkout', 'main'])
}
afterEach(async () => {
  if (repo) await stopRehearsal(repo)
  if (root) await rm(root, { recursive: true, force: true })
  vi.mocked(statfs).mockClear()
  vi.unstubAllEnvs()
})

describe.skipIf(!tool)('real CLI rehearsal management', () => {
  it('rediscovers exact retained identities, marks changed refs, and discards only confirmed matches', async () => {
    await fixture()
    const first = await rehearseMerge(tool, repo, 'topic')
    const second = await rehearseMerge(tool, repo, 'topic')
    expect(first.kind).toBe('report')
    expect(second.kind).toBe('report')
    const inventory = await listRehearsals(tool, repo)
    expect(inventory.entries).toHaveLength(2)
    expect(
      inventory.entries.every(
        (entry) => !entry.stale && !entry.active && entry.lifecycle === 'kept'
      )
    ).toBe(true)
    expect(inventory.bytes).toBeGreaterThan(0)
    expect(inventory.freeBytes).toBeGreaterThan(0)
    // Each inspection starts a new CLI process; list's prune keeps retained entries.
    await runRehearsalTool(tool!, ['--json', 'list'], repo)
    expect((await listRehearsals(tool, repo)).entries.map((entry) => entry.id)).toEqual(
      inventory.entries.map((entry) => entry.id)
    )
    const wrong = await discardRehearsals(tool, repo, [
      { ...inventory.entries[0], repository_id: 'wrong' }
    ])
    expect(wrong.discarded).toEqual([])
    expect(wrong.failures).toHaveLength(1)
    const mixed = await discardRehearsals(tool, repo, [
      { ...inventory.entries[0], id: 'missing' },
      inventory.entries[0]
    ])
    expect(mixed.discarded).toEqual([inventory.entries[0].id])
    expect(mixed.failures).toHaveLength(1)
    expect((await listRehearsals(tool, repo)).entries.map((entry) => entry.id)).toEqual([
      inventory.entries[1].id
    ])
    await writeFile(join(repo, 'new.txt'), 'new basis\n')
    await runGit(repo, ['add', '.'])
    await runGit(repo, ['commit', '-m', 'move main'])
    expect((await listRehearsals(tool, repo)).entries[0].stale).toBe(true)
    expect((await rehearsalShow(tool, inventory.entries[1])).kind).toBe('report')
    // Recovery protection is authoritative in the CLI, even if UI state is stale.
    await writeFile(join(repo, '.git', 'rehearse-apply'), 'invalid journal')
    const protectedResult = await discardRehearsals(tool, repo, [inventory.entries[1]])
    expect(protectedResult.discarded).toEqual([])
    expect(protectedResult.failures).toHaveLength(1)
    expect((await listRehearsals(tool, repo)).protected).toBe(true)
    expect((await listRehearsals(tool, repo)).entries).toHaveLength(1)
  }, 120_000)

  it('warns about low space without deleting retained work, and treats unreadable space as unknown', async () => {
    await fixture()
    await rehearseMerge(tool, repo, 'topic')
    vi.mocked(statfs).mockResolvedValueOnce({
      type: 0,
      bsize: 4096,
      blocks: 100,
      bfree: 1,
      bavail: 1,
      files: 100,
      ffree: 50
    })
    const low = await listRehearsals(tool, repo)
    expect(low.lowSpace).toBe(true)
    expect(low.entries).toHaveLength(1)
    vi.mocked(statfs).mockRejectedValueOnce(new Error('unavailable'))
    const unknown = await listRehearsals(tool, repo)
    expect(unknown.freeBytes).toBeNull()
    expect(unknown.warning).toContain('unavailable')
    expect(unknown.entries[0].id).toBe(low.entries[0].id)
  }, 120_000)

  it('keeps linked-worktree ownership and never discards a rehearsal through another origin', async () => {
    await fixture()
    const linked = join(root, 'linked')
    await runGit(repo, ['worktree', 'add', '-b', 'linked', linked])
    await rehearseMerge(tool, linked, 'topic')
    const linkedInventory = await listRehearsals(tool, linked)
    expect(linkedInventory.entries).toHaveLength(1)
    expect(linkedInventory.entries[0].origin_worktree).toBe(linkedInventory.repository)
    expect((await listRehearsals(tool, repo)).entries).toEqual([])
    expect((await discardRehearsals(tool, repo, linkedInventory.entries)).discarded).toEqual([])
    expect((await listRehearsals(tool, linked)).entries).toHaveLength(1)
  }, 120_000)

  it('refuses active discard, stops the process tree, reloads incomplete state and preserves other work', async () => {
    await fixture()
    await rehearseMerge(tool, repo, 'topic')
    const preserved = (await listRehearsals(tool, repo)).entries[0]
    await writeFile(join(repo, 'file.txt'), 'main\n')
    await writeFile(join(repo, '.gitattributes'), 'file.txt merge=wait\n')
    await runGit(repo, ['add', '.'])
    await runGit(repo, ['commit', '-m', 'diverge'])
    const sentinel = join(root, 'started')
    const late = join(root, 'late')
    const driver = join(root, 'driver.sh')
    await writeFile(driver, `#!/bin/sh\ntouch '${sentinel}'\nsleep 8\ntouch '${late}'\nexit 1\n`)
    await chmod(driver, 0o700)
    await runGit(repo, ['config', 'merge.wait.driver', driver])
    const before = {
      head: await runGit(repo, ['rev-parse', 'HEAD']),
      index: await readFile(join(repo, '.git/index')),
      file: await readFile(join(repo, 'file.txt'))
    }
    const running = rehearseMerge(tool, repo, 'topic')
    await vi.waitFor(
      async () => {
        expect(await readFile(sentinel, 'utf8')).toBe('')
      },
      { timeout: 15_000 }
    )
    const active = (await listRehearsals(tool, repo)).entries.find((entry) => entry.active)!
    expect(active).toBeTruthy()
    expect((await discardRehearsals(tool, repo, [active])).failures).toHaveLength(1)
    // A direct CLI caller must also be refused by the companion ownership lock.
    expect((await runRehearsalTool(tool!, ['--json', 'discard', active.id], repo)).code).not.toBe(0)
    expect((await stopRehearsal(repo)).ok).toBe(true)
    await running
    const stopped = (await listRehearsals(tool, repo)).entries.find(
      (entry) => entry.id === active.id
    )!
    expect(stopped.active).toBe(false)
    expect(stopped.execution).toBe('incomplete')
    const shown = await rehearsalShow(tool, stopped)
    expect(shown.kind).toBe('report')
    if (shown.kind === 'report') expect(shown.report.can_apply).toBe(false)
    expect((await discardRehearsals(tool, repo, [stopped])).discarded).toEqual([stopped.id])
    expect((await listRehearsals(tool, repo)).entries.map((entry) => entry.id)).toEqual([
      preserved.id
    ])
    expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(before.head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
    expect(await readFile(join(repo, 'file.txt'))).toEqual(before.file)
    await expect(readFile(late)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 120_000)
})
