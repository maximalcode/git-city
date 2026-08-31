import type { OpResult } from '../../shared/types'
import { gitOp } from './gitOp'

/**
 * History-shaping operations. All non-interactive; GIT_EDITOR=true (set in
 * exec.ts) keeps --continue from opening an editor.
 *
 * These were the proof of the shared coda (#113): six operations, each one a
 * git invocation that may stop on conflicts.
 */

export const cherryPick = (repoPath: string, hash: string): Promise<OpResult> =>
  gitOp(repoPath, ['cherry-pick', hash], { conflicts: true })
export const cherryPickContinue = (repoPath: string): Promise<OpResult> =>
  gitOp(repoPath, ['cherry-pick', '--continue'], { conflicts: true })
export const cherryPickAbort = (repoPath: string): Promise<OpResult> =>
  gitOp(repoPath, ['cherry-pick', '--abort'], { conflicts: true })

export const rebaseOnto = (repoPath: string, onto: string): Promise<OpResult> =>
  gitOp(repoPath, ['rebase', onto], { conflicts: true })
export const rebaseContinue = (repoPath: string): Promise<OpResult> =>
  gitOp(repoPath, ['rebase', '--continue'], { conflicts: true })
export const rebaseAbort = (repoPath: string): Promise<OpResult> =>
  gitOp(repoPath, ['rebase', '--abort'], { conflicts: true })
