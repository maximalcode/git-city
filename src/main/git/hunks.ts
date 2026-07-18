import type { DiffLine, FileHunks, HunkInfo, HunkMode, OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { failFrom, ok } from './result'

/**
 * Partial (hunk-level) staging — the core of `git add -p`. We never reconstruct
 * patches from typed lines: we split the *raw* `git diff` output on hunk
 * boundaries and re-apply the exact bytes with `git apply`, so whitespace,
 * CRLF and "no newline at end of file" all round-trip correctly.
 *
 *   stage   = apply the unstaged hunk to the index         (git apply --cached)
 *   unstage = reverse-apply the staged hunk from the index (git apply --cached --reverse)
 *   discard = reverse-apply the unstaged hunk to the tree  (git apply --reverse)
 *
 * All operate on local objects only — no remote is ever touched.
 */

/** Split a single-file `git diff` into its header block and raw hunk texts. */
export function splitDiff(raw: string): { header: string; hunks: string[] } {
  const first = raw.search(/^@@ /m)
  if (first === -1) return { header: raw, hunks: [] }
  const header = raw.slice(0, first)
  const body = raw.slice(first)
  // split before each line that starts a hunk, keeping the '@@' with its block
  const hunks = body.split(/(?=^@@ )/m).filter((h) => h.startsWith('@@ '))
  return { header, hunks }
}

function typedLines(hunkText: string): { lines: DiffLine[]; additions: number; deletions: number } {
  const lines: DiffLine[] = []
  let additions = 0
  let deletions = 0
  const raw = hunkText.split('\n')
  // raw[0] is the @@ header; the trailing '' from a final newline is skipped
  for (let i = 1; i < raw.length; i++) {
    const l = raw[i]
    if (i === raw.length - 1 && l === '') break
    if (l.startsWith('\\')) continue // "\ No newline at end of file"
    if (l.startsWith('+')) {
      lines.push({ kind: 'add', text: l.slice(1) })
      additions++
    } else if (l.startsWith('-')) {
      lines.push({ kind: 'del', text: l.slice(1) })
      deletions++
    } else {
      lines.push({ kind: 'ctx', text: l.startsWith(' ') ? l.slice(1) : l })
    }
  }
  return { lines, additions, deletions }
}

async function rawDiff(repoPath: string, path: string, staged: boolean): Promise<string> {
  const args = ['-c', 'core.quotepath=false', 'diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', path)
  const r = await runGitResult(repoPath, args)
  return r.code === 0 ? r.stdout : ''
}

export async function getFileHunks(
  repoPath: string,
  path: string,
  staged: boolean
): Promise<FileHunks> {
  const raw = await rawDiff(repoPath, path, staged)
  if (raw.includes('Binary files ') || raw.includes('GIT binary patch')) {
    return { path, staged, binary: true, hunks: [] }
  }
  const { hunks } = splitDiff(raw)
  const out: HunkInfo[] = hunks.map((text, index) => {
    const header = text.slice(0, text.indexOf('\n'))
    const { lines, additions, deletions } = typedLines(text)
    return { index, header, additions, deletions, lines }
  })
  return { path, staged, binary: false, hunks: out }
}

export async function applyHunk(
  repoPath: string,
  path: string,
  hunkHeader: string,
  mode: HunkMode
): Promise<OpResult> {
  // stage/discard operate on the unstaged diff; unstage on the staged one
  const fromStaged = mode === 'unstage'
  const raw = await rawDiff(repoPath, path, fromStaged)
  const { header, hunks } = splitDiff(raw)

  // Locate by the @@ line, not a stale index — if the change moved (an external
  // edit, or another hunk was staged first) matching fails and we ask for a reopen.
  const hunkText = hunks.find((h) => h.startsWith(hunkHeader))
  if (!hunkText) {
    return { ok: false, code: 'nothing-to-do', message: 'This change moved — reopen the file.' }
  }

  const patch = header + hunkText
  const args = ['apply']
  if (mode === 'stage' || mode === 'unstage') args.push('--cached')
  if (mode === 'unstage' || mode === 'discard') args.push('--reverse')
  args.push('-') // read the patch from stdin

  const res = await runGitResult(repoPath, args, { input: patch })
  return res.code === 0 ? ok() : failFrom(res)
}
