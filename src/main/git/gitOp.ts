import type { OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'
import { getWorkingStatus } from './status'

/**
 * The write-operation coda, once instead of twenty-five times (#113).
 *
 * Most of src/main/git is *build args → run → this coda* — `advanced.ts` had
 * the shape all along and fit six operations into 29 lines while `tags.ts`
 * needed 43 for three. Each concern module is now a list of git invocations
 * that end in `gitOp`.
 */

/** Run git and turn its exit into an OpResult, attaching conflicts when asked. */
async function withConflicts(repoPath: string, result: OpResult): Promise<OpResult> {
  if (!result.ok && result.code === 'conflict') {
    const status = await getWorkingStatus(repoPath)
    result.conflicts = status.files.filter((f) => f.conflicted).map((f) => f.path)
  }
  return result
}

export interface GitOpOptions {
  /** list the conflicted files when git stops on a conflict (merge, rebase, stash pop) */
  conflicts?: boolean
  env?: Record<string, string>
  input?: string
}

/** Run one git command and turn its exit into an OpResult. */
export async function gitOp(
  repoPath: string,
  args: string[],
  opts?: GitOpOptions
): Promise<OpResult> {
  const res = await runGitResult(repoPath, args, opts)
  if (res.code === 0) return ok()
  return opts?.conflicts ? withConflicts(repoPath, failFrom(res)) : failFrom(res)
}
