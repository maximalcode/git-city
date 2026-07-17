import { useEffect } from 'react'

/**
 * Minimal global hotkey hook (hand-rolled — no dependency). Ignores keystrokes
 * while the user is typing in an input/textarea/contenteditable, and can be
 * disabled entirely (e.g. while a modal dialog or the merge view is open).
 */
export function useHotkeys(map: Record<string, () => void>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
      const handler = map[key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map, enabled])
}
