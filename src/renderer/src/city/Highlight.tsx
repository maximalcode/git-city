import { useStore } from '../store'
import type { CityModel, Targets } from './cityData'

/** Bright translucent box around the hovered / selected building (picked up by bloom). */
export default function Highlight({
  model,
  targets
}: {
  model: CityModel
  targets: Targets
}): React.JSX.Element | null {
  const hovered = useStore((s) => s.hovered)
  const selected = useStore((s) => s.selected)

  return (
    <>
      {hovered && hovered !== selected && (
        <Marker model={model} targets={targets} path={hovered} color="#6ec8ff" opacity={0.25} />
      )}
      {selected && (
        <Marker model={model} targets={targets} path={selected} color="#ffb347" opacity={0.35} />
      )}
    </>
  )
}

function Marker({
  model,
  targets,
  path,
  color,
  opacity
}: {
  model: CityModel
  targets: Targets
  path: string
  color: string
  opacity: number
}): React.JSX.Element | null {
  const i = model.indexOf.get(path)
  if (i === undefined) return null
  const h = targets.heights[i]
  if (h <= 0) return null
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
