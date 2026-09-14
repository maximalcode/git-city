import { afterEach, expect, it, vi } from 'vitest'
import * as filesystem from 'fs/promises'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile, symlink, mkdir, link, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { rehearse, rehearsalShow } from './rehearsal'
import {
  continueRehearsal,
  readRehearsalConflict,
  saveRehearsalConflict
} from './rehearsalConflicts'
import { applyRehearsal } from './rehearsalRecovery'

// Wrap only the open boundary; all filesystem operations still execute for real.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

const tool = process.env.GIT_CITY_REHEARSE_BIN
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

it.skipIf(!tool).each(['merge', 'rebase', 'cherry-pick'] as const)(
  'resolves %s in isolation and adopts the exact final result',
  async (action) => {
    const repo = await mkdtemp(join(tmpdir(), 'city-conflicts-'))
    cleanup.push(() => rm(repo, { recursive: true, force: true }))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    await writeFile(join(repo, 'file.txt'), 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'topic')
    await writeFile(join(repo, 'file.txt'), 'topic\n')
    git('commit', '-am', 'topic')
    const target = git('rev-parse', 'HEAD')
    git('checkout', 'main')
    await writeFile(join(repo, 'file.txt'), 'main\n')
    git('commit', '-am', 'main')
    if (action === 'rebase') {
      await writeFile(join(repo, 'file.txt'), 'second\n')
      git('commit', '-am', 'second')
    }
    const before = {
      head: git('rev-parse', 'HEAD'),
      index: await readFile(join(repo, '.git/index')),
      file: await readFile(join(repo, 'file.txt'))
    }
    const result = await rehearse(tool, repo, action, target)
    if (result.kind !== 'report') throw new Error(JSON.stringify(result))
    let report = result.report
    cleanup.push(async () => {
      execFileSync(tool!, ['--json', 'discard', report.id], { cwd: repo })
    })
    expect(report.outcome).toBe('stopped')
    expect((await applyRehearsal(tool, report)).kind).toBe('refused')
    const sandbox = report.sandbox!
    for (const path of [
      '../file.txt',
      '/etc/passwd',
      '.git/config',
      'folder/../../file.txt',
      'folder\\file.txt'
    ])
      await expect(readRehearsalConflict(tool, report, path)).rejects.toThrow()
    await expect(
      readRehearsalConflict(tool, { ...report, id: report.id + 'wrong' }, 'file.txt')
    ).rejects.toThrow()
    await expect(
      readRehearsalConflict(tool, { ...report, repository_id: 'wrong' }, 'file.txt')
    ).rejects.toThrow()
    await rename(join(sandbox, '.git'), join(sandbox, 'saved-git'))
    try {
      await symlink(join(repo, '.git'), join(sandbox, '.git'), 'junction')
      await expect(readRehearsalConflict(tool, report, 'file.txt')).rejects.toThrow()
    } finally {
      await rm(join(sandbox, '.git'))
      await rename(join(sandbox, 'saved-git'), join(sandbox, '.git'))
    }
    // Swap a validated ancestor exactly at the open boundary; Git and the
    // filesystem stay real, including the outside file descriptor returned.
    const actualOpen = (await vi.importActual<typeof import('fs/promises')>('fs/promises')).open
    const opening = vi.mocked(filesystem.open).mockImplementationOnce(async (...args) => {
      await rename(sandbox, sandbox + '-saved')
      await symlink(repo, sandbox, 'junction')
      return actualOpen(...args)
    })
    try {
      await expect(readRehearsalConflict(tool, report, 'file.txt')).rejects.toThrow('replaced')
    } finally {
      opening.mockImplementation(actualOpen)
      await rm(sandbox)
      await rename(sandbox + '-saved', sandbox)
    }
    const buffer = await readRehearsalConflict(tool, report, 'file.txt')
    await writeFile(join(sandbox, 'file.txt'), 'external resolution\n')
    await expect(
      saveRehearsalConflict(tool, report, 'file.txt', buffer.revision, 'stale')
    ).rejects.toThrow('changed on disk')
    expect(await readFile(join(sandbox, 'file.txt'), 'utf8')).toBe('external resolution\n')
    await rm(join(sandbox, 'file.txt'))
    await symlink(join(repo, 'file.txt'), join(sandbox, 'file.txt'))
    await expect(readRehearsalConflict(tool, report, 'file.txt')).rejects.toThrow('Symlink')
    await expect(
      saveRehearsalConflict(tool, report, 'file.txt', buffer.revision, 'unsafe')
    ).rejects.toThrow('Symlink')
    await rm(join(sandbox, 'file.txt'))
    await link(join(repo, 'file.txt'), join(sandbox, 'file.txt'))
    await expect(
      saveRehearsalConflict(tool, report, 'file.txt', buffer.revision, 'unsafe')
    ).rejects.toThrow('regular')
    await rm(join(sandbox, 'file.txt'))
    await mkdir(join(sandbox, 'nested'))
    await symlink(repo, join(sandbox, 'nested', 'escape'))
    await expect(readRehearsalConflict(tool, report, 'nested/escape/file.txt')).rejects.toThrow(
      'Symlink'
    )
    await rm(join(sandbox, 'nested'), { recursive: true })
    await writeFile(join(sandbox, 'file.txt'), 'external resolution\n')
    for (let stop = 0; stop < (action === 'rebase' ? 2 : 1); stop++) {
      const fresh = await readRehearsalConflict(tool, report, 'file.txt')
      await saveRehearsalConflict(tool, report, 'file.txt', fresh.revision, `reviewed ${stop}\n`)
      const shown = await rehearsalShow(tool, report)
      expect(shown.kind === 'report' && shown.report.conflicts).toEqual([])
      const next = await continueRehearsal(tool, report)
      if (next.kind !== 'report') throw new Error(JSON.stringify(next))
      report = next.report
      expect(report.outcome).toBe(action === 'rebase' && stop === 0 ? 'stopped' : 'clean')
      expect(git('rev-parse', 'HEAD')).toBe(before.head)
      expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
      expect(await readFile(join(repo, 'file.txt'))).toEqual(before.file)
    }
    const expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sandbox,
      encoding: 'utf8'
    }).trim()
    const expectedFile = await readFile(join(sandbox, 'file.txt'))
    const applied = await applyRehearsal(tool, report)
    expect(applied.kind, JSON.stringify(applied)).toBe('applied')
    expect(git('rev-parse', 'HEAD')).toBe(expectedHead)
    expect(await readFile(join(repo, 'file.txt'))).toEqual(expectedFile)
    cleanup.pop() // successful Apply removed its own sandbox
  },
  180000
)

it.skipIf(!tool).each(['ours', 'theirs', 'delete', 'rename'] as const)(
  'finishes %s conflicts without touching the origin',
  async (choice) => {
    const repo = await mkdtemp(join(tmpdir(), 'city-external-'))
    cleanup.push(() => rm(repo, { recursive: true, force: true }))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    const binary = choice === 'ours' || choice === 'theirs'
    await writeFile(join(repo, 'file'), binary ? Buffer.from([0, 255, 1]) : 'base\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'topic')
    if (choice === 'rename') git('mv', 'file', 'topic-name')
    else await writeFile(join(repo, 'file'), binary ? Buffer.from([0, 254, 2]) : 'topic\n')
    git('add', '.')
    git('commit', '-m', 'topic')
    git('checkout', 'main')
    if (choice === 'delete') git('rm', 'file')
    else if (choice === 'rename') git('mv', 'file', 'main-name')
    else await writeFile(join(repo, 'file'), Buffer.from([0, 253, 3]))
    git('add', '.')
    git('commit', '-m', 'main')
    const head = git('rev-parse', 'HEAD')
    const index = await readFile(join(repo, '.git/index'))
    const original = git('status', '--porcelain')
    const result = await rehearse(tool, repo, 'merge', 'topic')
    if (result.kind !== 'report') throw new Error(JSON.stringify(result))
    const report = result.report
    cleanup.push(async () => {
      execFileSync(tool!, ['--json', 'discard', report.id], { cwd: repo })
    })
    expect(report.outcome).toBe('stopped')
    const sandbox = report.sandbox!
    const path = binary ? 'file' : report.conflicts[0].path
    const buffer = await readRehearsalConflict(tool, report, path)
    await expect(
      saveRehearsalConflict(tool, { ...report, origin_worktree: sandbox }, path, buffer.revision, {
        side: 'ours'
      })
    ).rejects.toThrow()
    if (binary) {
      expect(buffer.file.binary).toBe(true)
      const expected = execFileSync('git', ['show', `:${choice === 'ours' ? 2 : 3}:file`], {
        cwd: sandbox
      })
      await writeFile(join(sandbox, 'file'), Buffer.from([0, 128]))
      await expect(
        saveRehearsalConflict(tool, report, path, buffer.revision, { side: choice })
      ).rejects.toThrow('changed on disk')
      const fresh = await readRehearsalConflict(tool, report, path)
      await rename(join(sandbox, path), join(sandbox, 'moved'))
      await expect(
        saveRehearsalConflict(tool, report, path, fresh.revision, { side: choice })
      ).rejects.toThrow('missing or renamed')
      await rename(join(sandbox, 'moved'), join(sandbox, path))
      await saveRehearsalConflict(tool, report, path, fresh.revision, { side: choice })
      expect(await readFile(join(sandbox, path))).toEqual(expected)
    } else {
      expect(buffer.external).toBe(true)
      await expect(
        saveRehearsalConflict(tool, report, path, buffer.revision, 'stale')
      ).rejects.toThrow('Deletion or rename')
      execFileSync('git', ['rm', '-f', '--', ...report.conflicts.map((c) => c.path)], {
        cwd: sandbox
      })
      await writeFile(join(sandbox, 'resolved'), 'external final\n')
      execFileSync('git', ['add', 'resolved'], { cwd: sandbox })
      await expect(
        saveRehearsalConflict(tool, report, path, buffer.revision, 'stale')
      ).rejects.toThrow()
    }
    const refreshed = await rehearsalShow(tool, report)
    expect(refreshed.kind === 'report' && refreshed.report.conflicts).toEqual([])
    const final = await continueRehearsal(tool, report)
    expect(final.kind === 'report' && final.report.outcome).toBe('clean')
    expect(git('rev-parse', 'HEAD')).toBe(head)
    expect(await readFile(join(repo, '.git/index'))).toEqual(index)
    expect(git('status', '--porcelain')).toBe(original)
  },
  180000
)
