import type { ConflictSegment } from './types'

/**
 * Conflict-marker parsing for the in-app resolver. Segments carry the raw
 * text INCLUDING original line endings, so concatenating chosen segments
 * reproduces the file byte-for-byte outside the conflicted regions.
 */

const OURS_RE = /^<{7}(?: (.*))?\r?\n?$/
const BASE_RE = /^\|{7}(?: (.*))?\r?\n?$/
const SEP_RE = /^={7}\r?\n?$/
const THEIRS_RE = /^>{7}(?: (.*))?\r?\n?$/

export function parseConflictSegments(content: string): ConflictSegment[] {
  // split keeping the newline on each line, so joins are lossless
  const lines = content.length === 0 ? [] : content.split(/(?<=\n)/)
  const segments: ConflictSegment[] = []
  let state: 'text' | 'ours' | 'base' | 'theirs' = 'text'
  let text: string[] = []
  let ours: string[] = []
  let base: string[] = []
  let theirs: string[] = []
  let oursLabel = ''
  let id = 0

  const flushText = (): void => {
    if (text.length > 0) segments.push({ kind: 'text', text: text.join('') })
    text = []
  }

  for (const line of lines) {
    if (state === 'text') {
      const m = OURS_RE.exec(line)
      if (m) {
        flushText()
        state = 'ours'
        oursLabel = (m[1] ?? '').trim()
        ours = []
        base = []
        theirs = []
      } else {
        text.push(line)
      }
    } else if (state === 'ours') {
      if (BASE_RE.test(line)) state = 'base'
      else if (SEP_RE.test(line)) state = 'theirs'
      else ours.push(line)
    } else if (state === 'base') {
      if (SEP_RE.test(line)) state = 'theirs'
      else base.push(line)
    } else {
      const m = THEIRS_RE.exec(line)
      if (m) {
        segments.push({
          kind: 'conflict',
          id: id++,
          ours: ours.join(''),
          theirs: theirs.join(''),
          base: state === 'theirs' && base.length > 0 ? base.join('') : undefined,
          oursLabel,
          theirsLabel: (m[1] ?? '').trim()
        })
        state = 'text'
      } else {
        theirs.push(line)
      }
    }
  }

  if (state !== 'text') {
    // unbalanced markers — hand the whole file to the raw-edit fallback
    return [{ kind: 'text', text: content }]
  }
  flushText()
  return segments
}
