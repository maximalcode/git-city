import type { OpResult, SubmoduleInfo } from '../../shared/types'
import { runGitResult } from './exec'
import { gitOp } from './gitOp'

/**
 * Parse `git submodule status` output. Each line is `<flag><sha> <path> (<ref>)`
 * where the leading flag is a space (in sync), `-` (uninitialized), `+`
 * (checked-out SHA differs) or `U` (merge conflicts). The `(<ref>)` describe is
 * absent for uninitialized submodules.
 */
export function parseSubmoduleStatus(raw: string): SubmoduleInfo[] {
  const out: SubmoduleInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const flag = line[0]
    const rest = line.slice(1).trimStart()
    const m = /^([0-9a-f]+)\s+(.+?)(?:\s+\((.*)\))?$/.exec(rest)
    if (!m) continue
    const state: SubmoduleInfo['state'] =
      flag === '-' ? 'uninitialized' : flag === '+' ? 'modified' : flag === 'U' ? 'conflict' : 'ok'
    out.push({ sha: m[1], path: m[2], describe: m[3] ?? '', state })
  }
  return out
}

/** List the repo's submodules (empty when there are none — not an error). */
export async function listSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
  const res = await runGitResult(repoPath, ['submodule', 'status'])
  if (res.code !== 0) return []
  return parseSubmoduleStatus(res.stdout)
}

/** Init + update all submodules, or just one path. */
export async function updateSubmodules(repoPath: string, path?: string): Promise<OpResult> {
  const args = ['submodule', 'update', '--init', '--recursive']
  if (path) args.push('--', path)
  return gitOp(repoPath, args)
}
