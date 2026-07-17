import { useEffect, useRef, useState } from 'react'

export interface PickerItem {
  id: string
  label: React.ReactNode
  hint?: string
}

/**
 * Shared dropdown for the HUD (theme picker, color-mode picker). Closes on
 * outside click or Escape — never on mouseleave, which made a brushing cursor
 * dismiss the menu accidentally.
 */
export default function Picker({
  buttonLabel,
  title,
  items,
  activeId,
  onPick
}: {
  buttonLabel: React.ReactNode
  title: string
  items: PickerItem[]
  activeId: string
  onPick: (id: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="picker" ref={rootRef}>
      <button
        className="active"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {buttonLabel}
      </button>
      {open && (
        <div className="picker-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              className={it.id === activeId ? 'active' : ''}
              title={it.hint}
              onClick={() => {
                onPick(it.id)
                setOpen(false)
              }}
            >
              {it.label}
              {it.hint && <span className="picker-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
