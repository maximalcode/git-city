import { parseConflictSegments } from '../../shared/conflictSegments'
export { parseConflictSegments } from '../../shared/conflictSegments'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ConflictFile, OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom } from './result'
import { gitOp } from './gitOp'

export async function readConflictFile(repoPath: string, path: string): Promise<ConflictFile> {
  const buf = await readFile(join(repoPath, path))
  const probe = buf.subarray(0, 8000)
  if (probe.includes(0)) {
    return { path, binary: true, segments: [] }
  }
  return { path, binary: false, segments: parseConflictSegments(buf.toString('utf8')) }
}

/** Write the resolved text exactly as assembled by the UI, then stage it. */
export async function resolveConflictFile(
  repoPath: string,
  path: string,
  resolvedText: string
): Promise<OpResult> {
  await writeFile(join(repoPath, path), resolvedText, 'utf8')
  return gitOp(repoPath, ['add', '--', path])
}

/** Whole-file resolution (the only option for binary conflicts). */
export async function resolveWholeFile(
  repoPath: string,
  path: string,
  side: 'ours' | 'theirs'
): Promise<OpResult> {
  const co = await runGitResult(repoPath, ['checkout', `--${side}`, '--', path])
  if (co.code !== 0) return failFrom(co)
  return gitOp(repoPath, ['add', '--', path])
}
