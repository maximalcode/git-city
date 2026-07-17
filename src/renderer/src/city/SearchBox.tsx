import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { CityModel } from './cityData'

const MAX_RESULTS = 8

/**
 * Fuzzy-ish path search over the city's buildings. Picking a result selects it,
 * which the camera fly-to in CameraControls picks up automatically.
 */
export default function SearchBox({ model }: { model: CityModel }): React.JSX.Element | null {
  const searchOpen = useStore((s) => s.searchOpen)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const setSelected = useStore((s) => s.setSelected)
  const [q, setQ] = useState('')
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

  if (!searchOpen) return null

  const pick = (path: string): void => {
    setSelected(path)
    setSearchOpen(false)
  }

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="text"
        placeholder="Find a file…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSearchOpen(false)
          if (e.key === 'Enter' && results[0]) pick(results[0])
        }}
      />
      {results.length > 0 && (
        <div className="search-results">
          {results.map((p) => (
            <button key={p} onClick={() => pick(p)} title={p}>
              {p}
            </button>
          ))}
        </div>
      )}
      {q.trim() && results.length === 0 && <div className="search-results empty">No match</div>}
    </div>
  )
}
