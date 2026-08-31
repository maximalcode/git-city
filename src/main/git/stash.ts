import type { OpResult, StashEntry } from '../../shared/types'
import { runGit, runGitResult } from './exec'
import { failFrom, nothingToDo, ok } from './result'
import { gitOp } from './gitOp'

export async function stashList(repoPath: string): Promise<StashEntry[]> {
  const raw = await runGit(repoPath, ['stash', 'list', '--format=%gd%x09%at%x09%gs'])
  const entries: StashEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [ref, at, ...msg] = line.split('\t')
    const m = /stash@\{(\d+)\}/.exec(ref)
    if (!m) continue
    entries.push({
      index: parseInt(m[1], 10),
      message: msg.join('\t'),
      date: (parseInt(at, 10) || 0) * 1000
    })
  }
  return entries
}

export async function stashPush(
  repoPath: string,
  message: string,
  includeUntracked: boolean
): Promise<OpResult> {
  const args = ['stash', 'push']
  if (includeUntracked) args.push('--include-untracked')
  if (message.trim()) args.push('-m', message.trim())
  const res = await runGitResult(repoPath, args)
  if (res.code !== 0) return failFrom(res)
  if (/No local changes to save/i.test(res.stdout + res.stderr)) {
    return nothingToDo('No local changes to stash.')
  }
  return ok()
}

/** NOTE: a pop that hits conflicts keeps the stash entry — the UI re-lists and says so. */
export async function stashPop(repoPath: string, index: number): Promise<OpResult> {
  return gitOp(repoPath, ['stash', 'pop', `stash@{${index}}`], { conflicts: true })
}

export async function stashApply(repoPath: string, index: number): Promise<OpResult> {
  return gitOp(repoPath, ['stash', 'apply', `stash@{${index}}`], { conflicts: true })
}

export async function stashDrop(repoPath: string, index: number): Promise<OpResult> {
  return gitOp(repoPath, ['stash', 'drop', `stash@{${index}}`])
}
