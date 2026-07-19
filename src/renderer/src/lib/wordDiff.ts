import type { DiffLine } from '../../../shared/types'

/**
 * Intra-line (word-level) and side-by-side diff helpers — pure, unit-tested.
 * The unified diff we get from git is line-based; these turn a removed/added
 * line pair into highlighted token spans, and a hunk's lines into aligned
 * two-column rows, so the diff reads like Fork / Sublime Merge.
 */

export interface WordSpan {
  text: string
  /** true = this token was removed (old side) or added (new side) */
  changed: boolean
}
export interface WordDiff {
  oldSpans: WordSpan[]
  newSpans: WordSpan[]
}

/** Split a line into word / whitespace / punctuation tokens. */
function tokenize(s: string): string[] {
  return s.match(/\w+|\s+|[^\w\s]/g) ?? []
}

/** Append a token to a span list, merging into the previous span of the same kind. */
function push(arr: WordSpan[], text: string, changed: boolean): void {
  const last = arr[arr.length - 1]
  if (last && last.changed === changed) last.text += text
  else arr.push({ text, changed })
}

/**
 * Token-level LCS diff between two lines. Returns merged spans for each side:
 * unchanged tokens are shared, `changed` tokens are the delete (old) / insert
 * (new). Lines are short, so the O(n·m) table is fine.
 */
export function wordDiff(oldLine: string, newLine: string): WordDiff {
  const a = tokenize(oldLine)
  const b = tokenize(newLine)
  const n = a.length
  const m = b.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const oldSpans: WordSpan[] = []
  const newSpans: WordSpan[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(oldSpans, a[i], false)
      push(newSpans, b[j], false)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(oldSpans, a[i], true)
      i++
    } else {
      push(newSpans, b[j], true)
      j++
    }
  }
  while (i < n) push(oldSpans, a[i++], true)
  while (j < m) push(newSpans, b[j++], true)
  return { oldSpans, newSpans }
}

/**
 * For each line in a hunk, the word-level spans to render when that line is one
 * of a matched delete/insert pair (a delete run directly followed by an insert
 * run, paired by position). Non-paired lines get `null` and render plain.
 */
export function pairedWordSpans(lines: DiffLine[]): (WordSpan[] | null)[] {
  const out: (WordSpan[] | null)[] = new Array(lines.length).fill(null)
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== 'del' && lines[i].kind !== 'add') {
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(i++)
    while (i < lines.length && lines[i].kind === 'add') adds.push(i++)
    const pairs = Math.min(dels.length, adds.length)
    for (let k = 0; k < pairs; k++) {
      const wd = wordDiff(lines[dels[k]].text, lines[adds[k]].text)
      out[dels[k]] = wd.oldSpans
      out[adds[k]] = wd.newSpans
    }
  }
  return out
}

export type SbsKind = 'ctx' | 'del' | 'add' | 'empty'
export interface SbsCell {
  text: string
  kind: SbsKind
  /** word-level spans when this cell is part of a matched del/add pair */
  spans: WordSpan[] | null
}
export interface SbsRow {
  left: SbsCell
  right: SbsCell
}

const EMPTY_CELL = (): SbsCell => ({ text: '', kind: 'empty', spans: null })

/**
 * Turn a hunk's unified lines into aligned two-column rows: context on both
 * sides, deletes on the left, inserts on the right, paired by position within a
 * del/add run (with word-level spans on paired rows).
 */
export function toSideBySide(lines: DiffLine[]): SbsRow[] {
  const rows: SbsRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.kind === 'ctx') {
      rows.push({
        left: { text: l.text, kind: 'ctx', spans: null },
        right: { text: l.text, kind: 'ctx', spans: null }
      })
      i++
      continue
    }
    const dels: string[] = []
    const adds: string[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++].text)
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++].text)
    const max = Math.max(dels.length, adds.length)
    for (let k = 0; k < max; k++) {
      const hasDel = k < dels.length
      const hasAdd = k < adds.length
      const paired = hasDel && hasAdd
      const wd = paired ? wordDiff(dels[k], adds[k]) : null
      rows.push({
        left: hasDel ? { text: dels[k], kind: 'del', spans: wd?.oldSpans ?? null } : EMPTY_CELL(),
        right: hasAdd ? { text: adds[k], kind: 'add', spans: wd?.newSpans ?? null } : EMPTY_CELL()
      })
    }
  }
  return rows
}
