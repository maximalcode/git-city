import { useEffect } from 'react'

/**
 * Minimal global hotkey hook (hand-rolled — no dependency). Ignores keystrokes
 * while the user is typing in an input/textarea/contenteditable.
 */
export function useHotkeys(map: Record<string, () => void>): void {
  useEffect(() => {
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
  }, [map])
}
