import type { BlameLine, FileCommit } from '../../shared/types'
import { runGit, runGitResult } from './exec'

/** Commit history for a single file, following it across renames. */
export async function fileHistory(repoPath: string, path: string): Promise<FileCommit[]> {
  const raw = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'log',
    '--follow',
    '--format=%H%x09%an%x09%at%x09%s',
    '--',
    path
  ])
  const commits: FileCommit[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [hash, author, at, ...rest] = line.split('\t')
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      author,
      date: (parseInt(at, 10) || 0) * 1000,
      subject: rest.join('\t')
    })
  }
  return commits
}

/**
 * Parse `git blame --porcelain` output. Each line group is a header
 * `<sha> <origLine> <finalLine> [numLines]`, optional metadata headers (only on
 * a sha's first appearance), then the content line prefixed with a tab. We
 * cache author/time per sha so repeat lines resolve correctly.
 */
export function parseBlamePorcelain(raw: string): BlameLine[] {
  const lines = raw.split('\n')
  const meta = new Map<string, { author: string; time: number }>()
  const out: BlameLine[] = []
  let i = 0

  while (i < lines.length) {
    const header = lines[i++]
    const m = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(header)
    if (!m) continue
    const sha = m[1]
    const finalLine = parseInt(m[2], 10)

    let author = meta.get(sha)?.author
    let time = meta.get(sha)?.time
    // metadata headers run until the tab-prefixed content line
    while (i < lines.length && !lines[i].startsWith('\t')) {
      const h = lines[i++]
      if (h.startsWith('author ')) author = h.slice(7)
      else if (h.startsWith('author-time ')) time = (parseInt(h.slice(12), 10) || 0) * 1000
    }
    const content = i < lines.length ? lines[i++].slice(1) : ''

    author = author ?? ''
    time = time ?? 0
    meta.set(sha, { author, time })
    out.push({
      lineNo: finalLine,
      commitShort: sha.slice(0, 7),
      author,
      date: time,
      text: content
    })
  }
  return out
}

export async function blameFile(
  repoPath: string,
  path: string,
  rev?: string
): Promise<BlameLine[]> {
  const args = ['-c', 'core.quotepath=false', 'blame', '--porcelain']
  if (rev) args.push(rev)
  args.push('--', path)
  const res = await runGitResult(repoPath, args)
  // throw like fileHistory/commitGraph — the readOnly IPC wrapper contains the
  // raw stderr and the panel shows a proper error state instead of "no blame"
  if (res.code !== 0) throw new Error(`git blame failed: ${res.stderr.trim()}`)
  return parseBlamePorcelain(res.stdout)
}
