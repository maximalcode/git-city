import type { OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'
import { getWorkingStatus } from './status'

/** Attach the conflicted file list when an op stopped on conflicts. */
export async function withConflicts(repoPath: string, result: OpResult): Promise<OpResult> {
  if (!result.ok && result.code === 'conflict') {
    const status = await getWorkingStatus(repoPath)
    result.conflicts = status.files.filter((f) => f.conflicted).map((f) => f.path)
  }
  return result
}

export async function mergeBranch(repoPath: string, branch: string): Promise<OpResult> {
  const res = await runGitResult(repoPath, ['merge', '--no-edit', branch])
  if (res.code === 0) return ok()
  return withConflicts(repoPath, failFrom(res))
}

export async function mergeAbort(repoPath: string): Promise<OpResult> {
  const res = await runGitResult(repoPath, ['merge', '--abort'])
  return res.code === 0 ? ok() : failFrom(res)
}

/** Conclude a merge whose conflicts are all resolved and staged. */
export async function mergeContinue(repoPath: string): Promise<OpResult> {
  const res = await runGitResult(repoPath, ['commit', '--no-edit'])
  if (res.code === 0) return ok()
  return withConflicts(repoPath, failFrom(res))
}
