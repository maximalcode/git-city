import type { OpResult, TagInfo } from '../../shared/types'
import { runGit, runGitResult } from './exec'
import { failFrom, ok } from './result'

/** List tags with their target short-hash and subject, newest first. */
export async function listTags(repoPath: string): Promise<TagInfo[]> {
  const raw = await runGit(repoPath, [
    'for-each-ref',
    'refs/tags',
    '--sort=-creatordate',
    '--format=%(refname:short)%09%(objectname:short)%09%(creatordate:unix)%09%(contents:subject)'
  ])
  const tags: TagInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [name, target, date, ...subject] = line.split('\t')
    tags.push({
      name,
      target,
      date: (parseInt(date, 10) || 0) * 1000,
      subject: subject.join('\t')
    })
  }
  return tags
}

export async function createTag(
  repoPath: string,
  name: string,
  ref?: string
): Promise<OpResult> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, code: 'nothing-to-do', message: 'Tag name is empty.' }
  const args = ['tag', trimmed]
  if (ref) args.push(ref)
  const res = await runGitResult(repoPath, args)
  return res.code === 0 ? ok() : failFrom(res)
}

export async function deleteTag(repoPath: string, name: string): Promise<OpResult> {
  const res = await runGitResult(repoPath, ['tag', '-d', name])
  return res.code === 0 ? ok() : failFrom(res)
}
