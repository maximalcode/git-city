import type { OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'
import { withConflicts } from './merge'

/**
 * History-shaping operations. All non-interactive; GIT_EDITOR=true (set in
 * exec.ts) keeps --continue from opening an editor.
 */

async function simple(repoPath: string, args: string[]): Promise<OpResult> {
  const res = await runGitResult(repoPath, args)
  if (res.code === 0) return ok()
  return withConflicts(repoPath, failFrom(res))
}

export const cherryPick = (repoPath: string, hash: string): Promise<OpResult> =>
  simple(repoPath, ['cherry-pick', hash])
export const cherryPickContinue = (repoPath: string): Promise<OpResult> =>
  simple(repoPath, ['cherry-pick', '--continue'])
export const cherryPickAbort = (repoPath: string): Promise<OpResult> =>
  simple(repoPath, ['cherry-pick', '--abort'])

export const rebaseOnto = (repoPath: string, onto: string): Promise<OpResult> =>
  simple(repoPath, ['rebase', onto])
export const rebaseContinue = (repoPath: string): Promise<OpResult> =>
  simple(repoPath, ['rebase', '--continue'])
export const rebaseAbort = (repoPath: string): Promise<OpResult> =>
  simple(repoPath, ['rebase', '--abort'])
