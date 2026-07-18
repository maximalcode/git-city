import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { CityModel } from './cityData'

const MAX_RESULTS = 8

/**
 * Fuzzy-ish path search over the city's buildings. Picking a result selects it,
 * which the camera fly-to in CameraRig picks up automatically.
 * Arrow keys move through the results, Enter picks the highlighted one.
 */
export default function SearchBox({ model }: { model: CityModel }): React.JSX.Element | null {
  const searchOpen = useStore((s) => s.searchOpen)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const setSelected = useStore((s) => s.setSelected)
  const [q, setQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
    else setQ('')
  }, [searchOpen])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return model.paths.filter((p) => p.toLowerCase().includes(needle)).slice(0, MAX_RESULTS)
  }, [q, model])

  // new query → highlight the first hit again
  useEffect(() => {
    setActiveIdx(0)
  }, [q])

  if (!searchOpen) return null

  const pick = (path: string): void => {
    setSelected(path)
    setSearchOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') setSearchOpen(false)
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[activeIdx]) {
      pick(results[activeIdx])
    }
  }

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="text"
        placeholder="Find a file…"
        aria-label="Find a file"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {results.length > 0 && (
        <div className="search-results" role="listbox">
          {results.map((p, i) => (
            <button
              key={p}
              role="option"
              aria-selected={i === activeIdx}
              className={i === activeIdx ? 'active' : ''}
              onClick={() => pick(p)}
              onMouseEnter={() => setActiveIdx(i)}
              title={p}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      {q.trim() && results.length === 0 && <div className="search-results empty">No match</div>}
    </div>
  )
}
