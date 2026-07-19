import type { OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'

export async function commit(
  repoPath: string,
  message: string,
  amend: boolean,
  sign?: boolean
): Promise<OpResult> {
  const trimmed = message.trim()
  if (!trimmed) return { ok: false, code: 'nothing-to-do', message: 'Commit message is empty.' }
  const args = ['commit', '-m', trimmed]
  if (amend) args.push('--amend')
  // explicit override of the repo's commit.gpgsign default; undefined = let git decide
  if (sign === true) args.push('-S')
  else if (sign === false) args.push('--no-gpg-sign')
  const res = await runGitResult(repoPath, args)
  return res.code === 0 ? ok() : failFrom(res)
}

export async function getLastCommitMessage(repoPath: string): Promise<string> {
  const res = await runGitResult(repoPath, ['log', '-1', '--format=%B'])
  return res.code === 0 ? res.stdout.trim() : ''
}
