import { useStore } from '../store'
import type { HeightSource, PlotSource } from './plots'

/**
 * Bright translucent box around the hovered / selected file (picked up by bloom).
 *
 * World-agnostic: it needs a plot rectangle and a height, which the city and the
 * farm both have. `floor` is what a world says its marker may shrink to — a
 * building of zero height is not there at all, while a field still occupies its
 * rectangle whatever is growing on it.
 */
export default function Highlight({
  model,
  targets,
  floor = 0
}: {
  model: PlotSource
  targets: HeightSource
  floor?: number
}): React.JSX.Element | null {
  const hovered = useStore((s) => s.hovered)
  const selected = useStore((s) => s.selected)

  return (
    <>
      {hovered && hovered !== selected && (
        <Marker
          model={model}
          targets={targets}
          floor={floor}
          path={hovered}
          color="#6ec8ff"
          opacity={0.25}
        />
      )}
      {selected && (
        <Marker
          model={model}
          targets={targets}
          floor={floor}
          path={selected}
          color="#ffb347"
          opacity={0.35}
        />
      )}
    </>
  )
}

function Marker({
  model,
  targets,
  floor,
  path,
  color,
  opacity
}: {
  model: PlotSource
  targets: HeightSource
  floor: number
  path: string
  color: string
  opacity: number
}): React.JSX.Element | null {
  const i = model.indexOf.get(path)
  if (i === undefined) return null
  if (targets.heights[i] <= 0) return null
  const h = Math.max(targets.heights[i], floor)
  const { rect } = model.layout.plots[i]
  const m = 0.25
  return (
    <mesh position={[rect.x + rect.w / 2, (h + m) / 2, rect.y + rect.h / 2]}>
      <boxGeometry args={[rect.w + m, h + m, rect.h + m]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  )
}
