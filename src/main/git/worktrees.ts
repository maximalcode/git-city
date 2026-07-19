import type { OpResult, WorktreeInfo } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'

/**
 * Parse `git worktree list --porcelain`: blank-line-separated blocks, each
 * starting with `worktree <path>` and carrying `HEAD <sha>`, `branch <ref>`,
 * or the flags `bare` / `detached` / `locked [reason]`.
 */
export function parseWorktreeList(raw: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = []
  let cur: Partial<WorktreeInfo> | null = null
  const flush = (): void => {
    if (cur?.path) {
      out.push({
        path: cur.path,
        head: cur.head ?? '',
        branch: cur.branch ?? null,
        bare: !!cur.bare,
        detached: !!cur.detached,
        locked: !!cur.locked
      })
    }
  }
  for (const line of raw.split('\n')) {
    if (line === '') {
      flush()
      cur = null
    } else if (line.startsWith('worktree ')) {
      flush()
      cur = { path: line.slice('worktree '.length) }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line === 'detached') {
      cur.detached = true
    } else if (line.startsWith('locked')) {
      cur.locked = true
    }
  }
  flush()
  return out
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const res = await runGitResult(repoPath, ['worktree', 'list', '--porcelain'])
  if (res.code !== 0) return []
  return parseWorktreeList(res.stdout)
}

/** Create a worktree at `path` for `ref` (a branch or commit). */
export async function addWorktree(repoPath: string, path: string, ref: string): Promise<OpResult> {
  const res = await runGitResult(repoPath, ['worktree', 'add', path, ref])
  return res.code === 0 ? ok() : failFrom(res)
}

/** Remove a worktree (force only when the user confirmed a dirty/locked one). */
export async function removeWorktree(
  repoPath: string,
  path: string,
  force: boolean
): Promise<OpResult> {
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(path)
  const res = await runGitResult(repoPath, args)
  return res.code === 0 ? ok() : failFrom(res)
}
