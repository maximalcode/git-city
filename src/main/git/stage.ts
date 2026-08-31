import { rm } from 'fs/promises'
import { join } from 'path'
import type { OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'
import { gitOp } from './gitOp'
import { getWorkingStatus } from './status'

export async function stageFiles(repoPath: string, paths: string[]): Promise<OpResult> {
  if (paths.length === 0) return ok()
  return gitOp(repoPath, ['add', '--', ...paths])
}

export async function unstageFiles(repoPath: string, paths: string[]): Promise<OpResult> {
  if (paths.length === 0) return ok()
  return gitOp(repoPath, ['restore', '--staged', '--', ...paths])
}

/**
 * Throw away worktree changes. The tracked/untracked split is re-derived from
 * a fresh `git status` — never trusted from the renderer, because deleting a
 * file believed untracked that is actually tracked would be data loss.
 */
export async function discardFiles(repoPath: string, paths: string[]): Promise<OpResult> {
  if (paths.length === 0) return ok()
  const status = await getWorkingStatus(repoPath)
  const untracked = new Set(
    status.files.filter((f) => f.worktree === 'untracked').map((f) => f.path)
  )

  const toRestore = paths.filter((p) => !untracked.has(p))
  const toDelete = paths.filter((p) => untracked.has(p))

  if (toRestore.length > 0) {
    const res = await runGitResult(repoPath, ['restore', '--worktree', '--', ...toRestore])
    if (res.code !== 0) return failFrom(res)
  }
  for (const rel of toDelete) {
    await rm(join(repoPath, rel), { force: true })
  }
  return ok()
}
