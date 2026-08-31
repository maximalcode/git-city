import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { OpResult, RebaseEntry } from '../../shared/types'
import { runGit, runGitResult } from './exec'
import { nothingToDo } from './result'
import { gitOp } from './gitOp'

/**
 * Load the last `count` first-parent commits of HEAD for the interactive-rebase
 * editor (newest first), plus the base they sit on. `base` is null when the
 * range reaches the root commit (caller rebases with --root).
 */
export async function getRebaseTodo(
  repoPath: string,
  count: number
): Promise<{ entries: RebaseEntry[]; base: string | null; hasMerges: boolean }> {
  const raw = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'log',
    '--first-parent',
    `--max-count=${count}`,
    '--format=%H%x09%P%x09%s',
    'HEAD'
  ])
  const entries: RebaseEntry[] = []
  let hasMerges = false
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [hash, parents, ...subject] = line.split('\t')
    if ((parents ?? '').split(' ').filter(Boolean).length > 1) hasMerges = true
    entries.push({ hash, shortHash: hash.slice(0, 7), subject: subject.join('\t'), action: 'pick' })
  }

  let base: string | null = null
  if (entries.length > 0) {
    const oldest = entries[entries.length - 1].hash
    const parent = await runGitResult(repoPath, ['rev-parse', '--verify', '--quiet', `${oldest}^`])
    base = parent.code === 0 ? parent.stdout.trim() : null
  }
  return { entries, base, hasMerges }
}

let todoCounter = 0

/**
 * Run a non-interactive `git rebase -i` by feeding it a prepared todo file.
 * The sequence editor is set to `cp "<ourTodo>"`; git appends its own todo
 * path, so cp overwrites it with ours — no node helper, no shell scripting.
 * `entries` arrive newest-first (display order) and are reversed to the
 * oldest-first order git's todo expects.
 *
 * `reword` is intentionally unsupported (needs per-commit message editing);
 * `squash` uses git's default combined message (GIT_EDITOR=true).
 */
export async function runInteractiveRebase(
  repoPath: string,
  base: string | null,
  entries: RebaseEntry[]
): Promise<OpResult> {
  const ordered = [...entries].reverse() // oldest-first for the todo
  if (ordered.length === 0) return nothingToDo('Nothing to rebase.')
  // a squash can't be the first line — promote it to pick
  if (ordered[0].action === 'squash') ordered[0] = { ...ordered[0], action: 'pick' }
  if (ordered.every((e) => e.action === 'drop')) {
    return nothingToDo('Cannot drop every commit.')
  }

  const todo = ordered.map((e) => `${e.action} ${e.hash}`).join('\n') + '\n'
  const todoFile = join(tmpdir(), `gitcity-rebase-${process.pid}-${todoCounter++}.txt`)
  await writeFile(todoFile, todo, 'utf8')

  // forward slashes so git's bundled sh doesn't treat Windows backslashes as escapes
  const editor = `cp "${todoFile.replace(/\\/g, '/')}"`
  const env = { GIT_SEQUENCE_EDITOR: editor, GIT_EDITOR: 'true' }

  const args = ['rebase', '-i']
  if (base) args.push(base)
  else args.push('--root')

  try {
    return await gitOp(repoPath, args, { conflicts: true, env })
  } finally {
    // the todo file lives in the shared temp dir — don't leave it behind
    await unlink(todoFile).catch(() => {})
  }
}
