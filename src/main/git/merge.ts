import type { OpResult } from '../../shared/types'
import { gitOp } from './gitOp'

export async function mergeBranch(repoPath: string, branch: string): Promise<OpResult> {
  return gitOp(repoPath, ['merge', '--no-edit', branch], { conflicts: true })
}

export async function mergeAbort(repoPath: string): Promise<OpResult> {
  return gitOp(repoPath, ['merge', '--abort'])
}

/** Conclude a merge whose conflicts are all resolved and staged. */
export async function mergeContinue(repoPath: string): Promise<OpResult> {
  return gitOp(repoPath, ['commit', '--no-edit'], { conflicts: true })
}
