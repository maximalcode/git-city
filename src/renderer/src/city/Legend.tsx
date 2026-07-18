import { useMemo } from 'react'
import type { Snapshot } from '../../../shared/types'
import { useStore } from '../store'
import { buildColorer, COLOR_MODES, type ColorContext } from './colorModes'

/** Explains what the current color mode's colors mean. */
export default function Legend({
  model,
  snapshot
}: {
  model: ColorContext
  snapshot: Snapshot
}): React.JSX.Element | null {
  const colorMode = useStore((s) => s.colorMode)
  const legend = useMemo(
    () => buildColorer(model, snapshot, colorMode).legend,
    [model, snapshot, colorMode]
  )
  const info = COLOR_MODES.find((m) => m.id === colorMode)
  if (legend.items.length === 0) return null

  return (
    <div className="legend">
      <div className="legend-title">{info?.name}</div>
      {legend.gradient ? (
        <div className="legend-gradient">
          <div
            className="legend-bar"
            style={{
              background: `linear-gradient(90deg, ${legend.items.map((i) => i.color).join(', ')})`
            }}
          />
          <div className="legend-ends">
            <span>{legend.items[0].label}</span>
            <span>{legend.items[legend.items.length - 1].label}</span>
          </div>
        </div>
      ) : (
        <div className="legend-list">
          {legend.items.map((it, idx) => (
            <div key={idx} className="legend-item">
              <span className="legend-swatch" style={{ background: it.color }} />
              <span className="legend-label">{it.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
