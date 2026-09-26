import { inspectUndo, undoRehearsal } from './rehearsalUndo'
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGit } from './git/exec'
import { rehearse, rehearseMerge, rehearsalShow } from './rehearsal'
import {
  applyRehearsal,
  commonRepository,
  inspectRecovery,
  recoverRehearsal
} from './rehearsalRecovery'

const tool = process.env.GIT_CITY_REHEARSE_BIN
const roots: string[] = []
afterEach(async () => {
  delete process.env.GIT_REHEARSE_ABORT_UNDO_AT
  delete process.env.GIT_REHEARSE_ABORT_APPLY_AT
  for (const root of roots.splice(0)) {
    if (tool) {
      spawnSync(tool, ['--json', 'recover', '--rollback'], { cwd: root })
      const listing = spawnSync(tool, ['--json', 'list'], { cwd: root, encoding: 'utf8' })
      if (listing.status === 0)
        for (const entry of JSON.parse(listing.stdout).rehearsals)
          spawnSync(tool, ['--json', 'discard', entry.id], { cwd: root })
    }
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-city-apply-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await runGit(root, ['config', 'user.name', 'Test'])
  await runGit(root, ['config', 'user.email', 'test@example.invalid'])
  await runGit(root, ['config', 'commit.gpgSign', 'false'])
  await writeFile(join(root, 'file.txt'), 'base\n')
  await writeFile(join(root, 'local.txt'), 'local base\n')
  await runGit(root, ['add', '.'])
  await runGit(root, ['commit', '-m', 'base'])
  await runGit(root, ['checkout', '-b', 'topic'])
  await writeFile(join(root, 'file.txt'), 'topic\n')
  await runGit(root, ['commit', '-am', 'topic'])
  await runGit(root, ['checkout', 'main'])
  return root
}
async function snapshot(root: string) {
  return {
    head: await runGit(root, ['rev-parse', 'HEAD']),
    index: await readFile(join(root, '.git/index')),
    file: await readFile(join(root, 'file.txt')),
    local: await readFile(join(root, 'local.txt'))
  }
}

it('fails closed without a tool when an interrupted operation exists', async () => {
  const root = await fixture()
  expect((await inspectRecovery(undefined, root)).state).toBe('none')
  expect((await inspectRecovery(join(root, 'missing-tool'), root)).state).toBe('none')
  await writeFile(join(root, '.git/rehearse-apply'), 'unknown journal')
  expect((await inspectRecovery(undefined, root)).state).toBe('unknown')
  expect((await inspectRecovery(join(root, 'missing-tool'), root)).state).toBe('unknown')
  await rm(join(root, '.git/rehearse-apply'))
  await writeFile(join(root, '.git/rehearse-apply.lock'), '')
  expect((await inspectRecovery(undefined, root)).state).toBe('none')
  expect((await inspectRecovery(join(root, 'missing-tool'), root)).state).toBe('none')
})

describe.skipIf(!tool)('real Apply and Recovery CLI', () => {
  it.each(['rebase', 'cherry-pick'] as const)(
    'previews and applies exact %s results with local work',
    async (action) => {
      const root = await fixture()
      await writeFile(join(root, 'independent.txt'), 'main work\n')
      await runGit(root, ['add', '.'])
      await runGit(root, ['commit', '-m', 'independent main'])
      const target =
        action === 'rebase' ? 'topic' : (await runGit(root, ['rev-parse', 'topic'])).trim()
      await writeFile(join(root, 'local.txt'), 'carried work\n')
      await runGit(root, ['add', 'local.txt'])
      // Prime Git's cache-tree extension before comparing the raw index bytes.
      await runGit(root, ['write-tree'])
      const before = await snapshot(root)
      const preview = await rehearse(tool, root, action, target)
      if (preview.kind !== 'report') throw new Error(JSON.stringify(preview))
      expect(preview.report.command).toEqual([action, target])
      expect(preview.report.outcome).toBe('clean')
      expect(preview.report.can_apply).toBe(true)
      expect(preview.report.carried?.paths).toContain('local.txt')
      expect(await snapshot(root)).toEqual(before)
      const shown = await rehearsalShow(tool, preview.report)
      if (shown.kind !== 'report') throw new Error(JSON.stringify(shown))
      expect(shown.report.id).toBe(preview.report.id)
      expect(shown.report.origin_worktree).toBe(preview.report.origin_worktree)
      expect(shown.report.repository_id).toBe(preview.report.repository_id)
      const expected = shown.report.refs.find((ref) => ref.name === 'refs/heads/main')?.after
      expect(expected).toBeTruthy()
      expect((await applyRehearsal(tool, shown.report)).kind).toBe('applied')
      expect((await runGit(root, ['rev-parse', 'HEAD'])).trim()).toBe(expected)
      expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('topic\n')
      expect(await readFile(join(root, 'independent.txt'), 'utf8')).toBe('main work\n')
      expect(await readFile(join(root, 'local.txt'), 'utf8')).toBe('carried work\n')
      expect(await runGit(root, ['show', ':local.txt'])).toBe('local base\n')
      if (action === 'rebase') {
        expect((await runGit(root, ['rev-parse', 'HEAD^'])).trim()).toBe(
          (await runGit(root, ['rev-parse', 'topic'])).trim()
        )
      } else {
        expect((await runGit(root, ['rev-parse', 'HEAD^'])).trim()).toBe(before.head.trim())
      }
    },
    120_000
  )

  it.each(['rebase', 'cherry-pick'] as const)(
    'blocks Apply for a conflicting %s and preserves the original',
    async (action) => {
      const root = await fixture()
      await writeFile(join(root, 'file.txt'), 'conflicting main\n')
      await runGit(root, ['commit', '-am', 'conflict'])
      const target =
        action === 'rebase' ? 'topic' : (await runGit(root, ['rev-parse', 'topic'])).trim()
      // Prime Git's cache-tree extension before comparing the raw index bytes.
      await runGit(root, ['write-tree'])
      const before = await snapshot(root)
      const preview = await rehearse(tool, root, action, target)
      if (preview.kind !== 'report') throw new Error(JSON.stringify(preview))
      expect(preview.report.outcome).toBe('stopped')
      expect(preview.report.conflicted).toBe(true)
      expect(preview.report.can_apply).toBe(false)
      expect(preview.report.conflicts.map((entry) => entry.path)).toContain('file.txt')
      expect((await applyRehearsal(tool, preview.report)).kind).toBe('refused')
      expect(await snapshot(root)).toEqual(before)
      expect((await rehearsalShow(tool, preview.report)).kind).toBe('report')
    },
    120_000
  )

  it('applies the checked commit and the sandbox carry result as unstaged edits', async () => {
    const root = await fixture()
    await writeFile(join(root, 'local.txt'), 'staged\n')
    await runGit(root, ['add', 'local.txt'])
    await writeFile(join(root, 'local.txt'), 'unstaged\n')
    const preview = await rehearseMerge(tool, root, 'topic')
    expect(preview.kind, JSON.stringify(preview)).toBe('report')
    if (preview.kind !== 'report') return
    expect(preview.report.can_apply).toBe(true)
    const expected = preview.report.refs.find((r) => r.name === 'refs/heads/main')?.after
    const applied = await applyRehearsal(tool, preview.report)
    expect(applied.kind, JSON.stringify(applied)).toBe('applied')
    expect((await runGit(root, ['rev-parse', 'HEAD'])).trim()).toBe(expected)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('topic\n')
    expect(await readFile(join(root, 'local.txt'), 'utf8')).toBe('unstaged\n')
    expect(await runGit(root, ['show', ':local.txt'])).toBe('local base\n')
    expect(applied.recovery.state).toBe('none')
  }, 120_000)

  it('refuses new local work and newly occupied branches while retaining the result', async () => {
    const root = await fixture()
    const preview = await rehearseMerge(tool, root, 'topic')
    if (preview.kind !== 'report') throw new Error(JSON.stringify(preview))
    const original = await snapshot(root)
    expect(
      (await applyRehearsal(tool, { ...preview.report, command: ['merge', 'different'] })).kind
    ).toBe('refused')
    expect(await snapshot(root)).toEqual(original)
    await writeFile(join(root, 'local.txt'), 'new work\n')
    const before = await snapshot(root)
    expect((await applyRehearsal(tool, preview.report)).kind).toBe('refused')
    expect(await snapshot(root)).toEqual(before)
    await writeFile(join(root, 'local.txt'), 'local base\n')
    const linked = join(root, 'linked')
    await runGit(root, ['worktree', 'add', '--force', linked, 'main'])
    expect(await commonRepository(linked)).toBe(await commonRepository(root))
    const occupiedBefore = await snapshot(root)
    const foreignIndex = await readFile(join(root, '.git/worktrees/linked/index'))
    const refused = await applyRehearsal(tool, preview.report)
    expect(refused.kind, JSON.stringify(refused)).toBe('refused')
    expect(await snapshot(root)).toEqual(occupiedBefore)
    expect(await readFile(join(root, '.git/worktrees/linked/index'))).toEqual(foreignIndex)
    expect(spawnSync(tool!, ['--json', 'show', preview.report.id], { cwd: root }).status).toBe(0)
  }, 120_000)

  it('queries status after losing the real CLI success response without repeating Apply', async () => {
    const root = await fixture()
    const preview = await rehearseMerge(tool, root, 'topic')
    if (preview.kind !== 'report') throw new Error(JSON.stringify(preview))
    const wrapper = join(root, 'response-wrapper.cjs')
    const count = join(root, 'apply-count')
    await writeFile(
      wrapper,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const { appendFileSync } = require('fs');
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(tool)}, args, {encoding:'utf8'});
if (args[1] === 'apply') appendFileSync(${JSON.stringify(count)}, 'apply\\n');
else process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);
`
    )
    await chmod(wrapper, 0o755)
    const result = await applyRehearsal(wrapper, preview.report)
    expect(result.kind, JSON.stringify(result)).toBe('uncertain')
    expect(result.recovery.state).toBe('none')
    expect(await readFile(count, 'utf8')).toBe('apply\n')
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('topic\n')
  }, 120_000)

  it('detects an interrupted Apply from another worktree, then offers only safe recovery after restart', async () => {
    const root = await fixture()
    const linked = join(root, 'linked')
    await runGit(root, ['worktree', 'add', '-b', 'other', linked])
    const preview = await rehearseMerge(tool, root, 'topic')
    if (preview.kind !== 'report') throw new Error(JSON.stringify(preview))
    process.env.GIT_REHEARSE_ABORT_APPLY_AT = 'after-ref-transaction'
    const applied = await applyRehearsal(tool, preview.report)
    delete process.env.GIT_REHEARSE_ABORT_APPLY_AT
    expect(applied.kind).toBe('uncertain')
    const restarted = await inspectRecovery(tool, root)
    expect(restarted.state, JSON.stringify(restarted)).toBe('after_ref_change')
    expect(restarted.can_complete).toBe(true)
    expect((await inspectRecovery(tool, linked)).state).not.toBe('none')
    expect((await inspectRecovery(undefined, linked)).state).not.toBe('none')
    expect((await recoverRehearsal(tool, root, 'wrong-id', 'complete')).state).not.toBe('none')
    const recovered = await recoverRehearsal(tool, root, preview.report.id, 'complete')
    expect(recovered.state, JSON.stringify(recovered)).toBe('none')
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('topic\n')
    expect((await inspectRecovery(tool, linked)).state).toBe('none')
  }, 120_000)
})

describe.skipIf(!tool)('exact Undo Apply through the real CLI', () => {
  async function applied() {
    const root = await fixture()
    const before = await snapshot(root)
    const preview = await rehearseMerge(tool, root, 'topic')
    if (preview.kind !== 'report') throw new Error(JSON.stringify(preview))
    expect((await applyRehearsal(tool, preview.report)).kind).toBe('applied')
    const status = await inspectUndo(tool, root)
    expect(status.available).toBe(true)
    expect(status.rehearsal).toBe(preview.report.id)
    return { root, before, status }
  }
  it('restores the exact Apply and consumes backend availability', async () => {
    const { root, before, status } = await applied()
    expect((await undoRehearsal(tool, root, status)).kind).toBe('undone')
    const after = await snapshot(root)
    expect(after.head).toBe(before.head)
    expect(after.file).toEqual(before.file)
    expect(after.local).toEqual(before.local)
    expect(await runGit(root, ['status', '--porcelain'])).toBe('')
    expect((await inspectUndo(tool, root)).available).toBe(false)
  })
  it.each(['identity', 'worktree', 'dirty', 'ref', 'occupancy'] as const)(
    'refuses %s changes without changing contents or index',
    async (change) => {
      const { root, status } = await applied()
      if (change === 'dirty') await writeFile(join(root, 'file.txt'), 'new local work\n')
      if (change === 'ref')
        await runGit(root, ['commit', '--allow-empty', '-m', 'intervening commit'])
      if (change === 'occupancy') {
        await writeFile(join(root, '.git/info/exclude'), 'linked/\n')
        await runGit(root, ['worktree', 'add', '--force', join(root, 'linked'), 'main'])
      }
      const identity = { ...status }
      if (change === 'identity') identity.rehearsal = 'wrong-id'
      if (change === 'worktree') identity.worktree = join(root, 'wrong')
      const before = await snapshot(root)
      const refs = await runGit(root, ['show-ref'])
      expect((await undoRehearsal(tool, root, identity)).kind).toBe('refused')
      expect(await snapshot(root)).toEqual(before)
      expect(await runGit(root, ['show-ref'])).toBe(refs)
    }
  )
  it('refuses an Apply belonging to another real worktree', async () => {
    const { root, status } = await applied()
    const linked = join(root, 'linked')
    await runGit(root, ['worktree', 'add', '-b', 'other', linked])
    const before = await snapshot(root)
    const linkedIndex = await readFile(join(root, '.git/worktrees/linked/index'))
    expect((await inspectUndo(tool, linked)).available).toBe(false)
    expect((await undoRehearsal(tool, linked, status)).kind).toBe('refused')
    expect(await snapshot(root)).toEqual(before)
    expect(await readFile(join(root, '.git/worktrees/linked/index'))).toEqual(linkedIndex)
    expect(await readFile(join(linked, 'file.txt'), 'utf8')).toBe('topic\n')
  })
  it('routes interrupted Undo to recovery and never repeats it', async () => {
    const { root, before, status } = await applied()
    process.env.GIT_REHEARSE_ABORT_UNDO_AT = 'after-ref-transaction'
    const result = await undoRehearsal(tool, root, status)
    delete process.env.GIT_REHEARSE_ABORT_UNDO_AT
    expect(result.kind).toBe('uncertain')
    expect(result.recovery.operation).toBe('undo')
    const restarted = await inspectRecovery(tool, root)
    expect(restarted.state).not.toBe('none')
    expect((await undoRehearsal(tool, root, status)).kind).toBe('refused')
    expect((await recoverRehearsal(tool, root, status.rehearsal!, 'complete')).state).toBe('none')
    expect((await snapshot(root)).head).toBe(before.head)
    expect((await snapshot(root)).file).toEqual(before.file)
    expect((await inspectUndo(tool, root)).available).toBe(false)
  })
})
