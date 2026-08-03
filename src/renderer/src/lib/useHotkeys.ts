import { useEffect } from 'react'

/**
 * Minimal global hotkey hook (hand-rolled — no dependency). Ignores keystrokes
 * while the user is typing in an input/textarea/contenteditable, and can be
 * disabled entirely (e.g. while a modal dialog or the merge view is open).
 *
 * `always` names keys that keep working while disabled. Escape belongs there:
 * it is how you dismiss whatever is blocking, so switching it off along with
 * everything else leaves the user stuck with the overlay (#30).
 */
export function useHotkeys(
  map: Record<string, () => void>,
  enabled = true,
  always: readonly string[] = []
): void {
  useEffect(() => {
    if (!enabled && always.length === 0) return
    const exempt = new Set(always)
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
      if (!enabled && !exempt.has(key)) return
      const handler = map[key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `always` is a literal at every call site, so listing it would re-bind
    // every render; the keys it names never change for a given call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled])
}
