import type { OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'

export async function commit(
  repoPath: string,
  message: string,
  amend: boolean
): Promise<OpResult> {
  const trimmed = message.trim()
  if (!trimmed) return { ok: false, code: 'nothing-to-do', message: 'Commit message is empty.' }
  const args = ['commit', '-m', trimmed]
  if (amend) args.push('--amend')
  const res = await runGitResult(repoPath, args)
  return res.code === 0 ? ok() : failFrom(res)
}

export async function getLastCommitMessage(repoPath: string): Promise<string> {
  const res = await runGitResult(repoPath, ['log', '-1', '--format=%B'])
  return res.code === 0 ? res.stdout.trim() : ''
}
