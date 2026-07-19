/**
 * Tiny subsequence fuzzy matcher (hand-rolled — no dependency). Returns a score
 * for how well `query` matches `text`, or null when the query characters aren't
 * a subsequence of the text at all. Higher is better; consecutive runs and
 * word-start hits (after / . - _ or a camelCase boundary) score more, so a query
 * like "cmp" ranks "city/components/…" above a scattered match.
 */
export interface FuzzyMatch {
  score: number
  /** matched character indices in `text`, for optional highlighting */
  indices: number[]
}

const BOUNDARY = /[/.\-_ ]/

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return { score: 0, indices: [] }

  let qi = 0
  let score = 0
  let prevMatch = -2
  const indices: number[] = []

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    let bonus = 1
    if (ti === prevMatch + 1) bonus += 3 // consecutive run
    const prevChar = ti > 0 ? text[ti - 1] : '/'
    const isCamel =
      ti > 0 && prevChar === prevChar.toLowerCase() && text[ti] !== text[ti].toLowerCase()
    if (ti === 0 || BOUNDARY.test(prevChar) || isCamel) bonus += 4 // word start
    score += bonus
    indices.push(ti)
    prevMatch = ti
    qi++
  }

  if (qi < q.length) return null
  // tie-breakers: prefer tighter texts and an earlier first hit
  score -= text.length * 0.02
  score -= indices[0] * 0.1
  return { score, indices }
}

/** Filter + rank `items` by how well their `key` fuzzy-matches `query`. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
  limit = 20
): T[] {
  const q = query.trim()
  if (!q) return items.slice(0, limit)
  const scored: { item: T; score: number; order: number }[] = []
  for (let i = 0; i < items.length; i++) {
    const m = fuzzyMatch(q, key(items[i]))
    if (m) scored.push({ item: items[i], score: m.score, order: i })
  }
  // stable: equal scores keep their original order
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.slice(0, limit).map((s) => s.item)
}
