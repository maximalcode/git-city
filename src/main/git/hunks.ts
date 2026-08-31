import type { DiffLine, FileHunks, HunkInfo, HunkMode, OpResult } from '../../shared/types'
import { runGitResult } from './exec'
import { nothingToDo } from './result'
import { gitOp } from './gitOp'

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

/**
 * Rebuild a hunk that stages only a subset of its changed lines. `selected`
 * indexes the hunk's content lines (0-based, after the @@ header). Unselected
 * additions are dropped; unselected deletions become context; the @@ header
 * counts are recomputed. Returns null when the selection would produce no real
 * change, or when the hunk carries a "\ No newline at end of file" marker
 * (whole-hunk staging preserves those exactly; line-level cannot, so we refuse
 * rather than risk corrupting the file).
 */
export function buildLinePatch(hunkText: string, selected: number[]): string | null {
  if (hunkText.includes('\\ No newline at end of file')) return null
  const raw = hunkText.split('\n')
  const oldStart = parseInt(/^@@ -(\d+)/.exec(raw[0])?.[1] ?? '', 10)
  if (!Number.isFinite(oldStart)) return null

  const sel = new Set(selected)
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let keptChange = false

  // content lines are raw[1..]; a trailing '' from the final newline is skipped
  for (let i = 1; i < raw.length; i++) {
    const line = raw[i]
    if (i === raw.length - 1 && line === '') break
    const contentIdx = i - 1 // 0-based index the renderer uses
    const c0 = line[0]
    if (c0 === '+') {
      if (sel.has(contentIdx)) {
        out.push(line)
        newCount++
        keptChange = true
      }
      // unselected addition → omitted
    } else if (c0 === '-') {
      if (sel.has(contentIdx)) {
        out.push(line)
        oldCount++
        keptChange = true
      } else {
        // unselected deletion → keep the line as context on both sides
        out.push(' ' + line.slice(1))
        oldCount++
        newCount++
      }
    } else {
      // context (' ' or bare)
      out.push(line.startsWith(' ') ? line : ' ' + line)
      oldCount++
      newCount++
    }
  }

  if (!keptChange) return null
  const head = `@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`
  return [head, ...out].join('\n') + '\n'
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
    return nothingToDo('This change moved — reopen the file.')
  }

  const patch = header + hunkText
  const args = ['apply']
  if (mode === 'stage' || mode === 'unstage') args.push('--cached')
  if (mode === 'unstage' || mode === 'discard') args.push('--reverse')
  args.push('-') // read the patch from stdin

  return gitOp(repoPath, args, { input: patch })
}

/**
 * Stage/unstage/discard only the selected lines within a hunk (finer than
 * `applyHunk`). `lineIndices` are 0-based positions among the hunk's content
 * lines, as the renderer numbers them.
 */
export async function applyLines(
  repoPath: string,
  path: string,
  hunkHeader: string,
  lineIndices: number[],
  mode: HunkMode
): Promise<OpResult> {
  const fromStaged = mode === 'unstage'
  const raw = await rawDiff(repoPath, path, fromStaged)
  const { header, hunks } = splitDiff(raw)

  const hunkText = hunks.find((h) => h.startsWith(hunkHeader))
  if (!hunkText) {
    return nothingToDo('This change moved — reopen the file.')
  }

  const rebuilt = buildLinePatch(hunkText, lineIndices)
  if (!rebuilt) {
    return nothingToDo(
      'Select at least one changed line (use the whole hunk for files with no trailing newline).'
    )
  }

  const patch = header + rebuilt
  const args = ['apply']
  if (mode === 'stage' || mode === 'unstage') args.push('--cached')
  if (mode === 'unstage' || mode === 'discard') args.push('--reverse')
  args.push('--recount', '-')

  return gitOp(repoPath, args, { input: patch })
}
