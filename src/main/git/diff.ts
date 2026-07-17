import { join } from 'path'
import type { DiffFile, DiffHunk } from '../../shared/types'
import { runGitResult } from './exec'

/**
 * Parse unified-diff text into hunks of typed lines. Pure + total (never
 * throws) so it can be unit-tested against fixtures like the conflict parser.
 */
export function parseUnifiedDiff(raw: string): {
  hunks: DiffHunk[]
  binary: boolean
  additions: number
  deletions: number
} {
  const hunks: DiffHunk[] = []
  let cur: DiffHunk | null = null
  let binary = false
  let additions = 0
  let deletions = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      binary = true
      continue
    }
    if (line.startsWith('@@')) {
      cur = { header: line, lines: [] }
      hunks.push(cur)
      continue
    }
    if (!cur) continue // skip the pre-hunk header block (diff --git / index / ---/+++)
    if (line.startsWith('\\')) continue // "\ No newline at end of file"
    if (line.startsWith('+')) {
      cur.lines.push({ kind: 'add', text: line.slice(1) })
      additions++
    } else if (line.startsWith('-')) {
      cur.lines.push({ kind: 'del', text: line.slice(1) })
      deletions++
    } else {
      cur.lines.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line })
    }
  }
  return { hunks, binary, additions, deletions }
}

export interface DiffOpts {
  /** show the change introduced by this commit for the path (timeline mode) */
  rev?: string
}

/**
 * Build a DiffFile for one path. In working mode (no rev) it shows all
 * uncommitted changes vs HEAD; if the file is clean it falls back to the last
 * commit that touched it. In timeline mode it shows that commit's change.
 */
export async function getFileDiff(
  repoPath: string,
  path: string,
  opts: DiffOpts = {}
): Promise<DiffFile> {
  let raw = ''
  let title = ''

  if (opts.rev) {
    const r = await runGitResult(repoPath, ['show', '--format=', '-M', opts.rev, '--', path])
    raw = r.stdout
    title = `commit ${opts.rev.slice(0, 7)}`
  } else {
    const working = await runGitResult(repoPath, ['diff', 'HEAD', '--', path])
    if (working.code === 0 && working.stdout.trim()) {
      raw = working.stdout
      title = 'Uncommitted changes'
    } else {
      // clean tracked file → show its most recent change; untracked → whole file added
      const last = await runGitResult(repoPath, ['log', '-1', '--format=%H', '--', path])
      const hash = last.stdout.trim()
      if (hash) {
        const s = await runGitResult(repoPath, ['show', '--format=', '-M', hash, '--', path])
        raw = s.stdout
        title = `Last change · ${hash.slice(0, 7)}`
      } else {
        const untracked = await runGitResult(repoPath, [
          '-c',
          'core.quotepath=false',
          'diff',
          '--no-index',
          '--',
          nullDevice(),
          join(repoPath, path)
        ])
        // --no-index exits 1 when files differ; that's expected, use its output
        raw = untracked.stdout
        title = raw.trim() ? 'New file (untracked)' : 'No changes'
      }
    }
  }

  const parsed = parseUnifiedDiff(raw)
  return {
    path,
    title,
    binary: parsed.binary,
    hunks: parsed.hunks,
    additions: parsed.additions,
    deletions: parsed.deletions
  }
}

function nullDevice(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null'
}
