import type { ConflictFile } from './types'

/**
 * Do two reads of a conflicted file hold identical content?
 *
 * Pure comparison over the shared type, so it lives here: the renderer guards
 * writes with it, and the main-process conflict tests use it to prove a real
 * external edit is detectable.
 *
 * Two jobs, both about not losing work — a re-read that matches may keep the
 * user's hunk choices, and a buffer that no longer matches disk must never be
 * written back over it.
 */
export function sameConflict(a: ConflictFile, b: ConflictFile): boolean {
  if (a.path !== b.path || a.binary !== b.binary) return false
  if (a.segments.length !== b.segments.length) return false
  return a.segments.every((s, i) => {
    const t = b.segments[i]
    if (s.kind === 'text') return t.kind === 'text' && s.text === t.text
    return t.kind === 'conflict' && s.id === t.id && s.ours === t.ours && s.theirs === t.theirs
  })
}
