import { expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { rehearse } from './rehearsal'
import { getRebaseTodo } from './git/rebaseInteractive'
import {
  continueRehearsal,
  readRehearsalConflict,
  saveRehearsalConflict
} from './rehearsalConflicts'
import { applyRehearsal } from './rehearsalRecovery'

const tool = process.env.GIT_CITY_REHEARSE_BIN
it.skipIf(!tool).each(['reorder-squash-drop', 'repeated-conflicts', 'root'])(
  'rehearses the interactive %s plan and adopts exact commit objects',
  async (scenario) => {
    const repo = await mkdtemp(join(tmpdir(), 'city-interactive-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    let id: string | undefined
    try {
      git('init', '-b', 'main')
      git('config', 'user.name', 'Test')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'commit.gpgSign', 'false')
      for (let i = 0; i < 5; i++) {
        await writeFile(
          join(repo, scenario === 'repeated-conflicts' ? 'file' : `file${i}`),
          `${i}\n`
        )
        git('add', '.')
        git('commit', '-m', `commit${i}`)
      }
      const { base, entries } = await getRebaseTodo(repo, scenario === 'root' ? 15 : 4)
      if (scenario === 'reorder-squash-drop') {
        // Display order: 3 squash, 1 pick, 2 pick, 4 drop.
        entries[0].action = 'drop'
        entries[1].action = 'squash'
        entries.splice(0, entries.length, entries[1], entries[3], entries[2], entries[0])
      } else if (scenario === 'repeated-conflicts') {
        // Drop the first dependent edit. Replaying 2 and 3 must stop separately.
        entries[3].action = 'drop'
      } else entries[0].action = 'drop'
      const before = {
        head: git('rev-parse', 'HEAD'),
        index: await readFile(join(repo, '.git/index')),
        files: git('ls-files', '-s')
      }
      const result = await rehearse(tool, repo, 'rebase', base ?? 'root', { base, entries })
      if (result.kind !== 'report') throw new Error(JSON.stringify(result))
      let report = result.report
      id = report.id
      expect(report.plan).toEqual({ base, entries })
      expect(report.command).toEqual(['rebase', '-i', base ?? '--root'])
      if (scenario === 'repeated-conflicts') {
        for (let stop = 0; stop < 3; stop++) {
          expect(report.outcome).toBe('stopped')
          expect((await applyRehearsal(tool, report)).kind).toBe('refused')
          const file = await readRehearsalConflict(tool, report, 'file')
          await saveRehearsalConflict(tool, report, 'file', file.revision, `resolution ${stop}\n`)
          const next = await continueRehearsal(tool, report)
          if (next.kind !== 'report') throw new Error(JSON.stringify(next))
          report = next.report
          expect(report.id).toBe(id)
          expect(report.pre_state).toEqual(result.report.pre_state)
          expect(git('rev-parse', 'HEAD')).toBe(before.head)
          expect(await readFile(join(repo, 'file'), 'utf8')).toBe('4\n')
          expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
          expect(report.command).toEqual(result.report.command)
        }
      }
      expect(report.outcome).toBe('clean')
      expect(git('rev-parse', 'HEAD')).toBe(before.head)
      expect(await readFile(join(repo, '.git/index'))).toEqual(before.index)
      expect(git('ls-files', '-s')).toBe(before.files)
      const sandboxGit = (...args: string[]): string =>
        execFileSync('git', args, { cwd: report.sandbox!, encoding: 'utf8' }).trim()
      const expected = sandboxGit('rev-list', 'HEAD')
      if (scenario === 'reorder-squash-drop') {
        expect(sandboxGit('log', '--format=%s')).toBe('commit1\ncommit2\ncommit0')
        expect(sandboxGit('ls-files')).toBe('file0\nfile1\nfile2\nfile3')
      }
      const adopted = await applyRehearsal(tool, report)
      expect(adopted.kind, adopted.message).toBe('applied')
      expect(git('rev-list', 'HEAD')).toBe(expected)
      if (scenario === 'repeated-conflicts')
        expect(await readFile(join(repo, 'file'), 'utf8')).toBe('resolution 2\n')
    } finally {
      if (id) {
        const listing = JSON.parse(
          execFileSync(tool!, ['--json', 'list'], { cwd: repo, encoding: 'utf8' })
        )
        if (listing.rehearsals.some((item: { id: string }) => item.id === id))
          execFileSync(tool!, ['--json', 'discard', id], { cwd: repo })
      }
      await rm(repo, { recursive: true, force: true })
    }
  },
  300_000
)
