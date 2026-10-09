import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import type { RehearsalReviewChange } from '../../../shared/types'

/**
 * Pulsing beacons over the repo's activity hotspots (the files churning most
 * this week). One per anchor: a downward marker cone that bobs above the
 * rooftop/canopy, plus an expanding halo ring that fades — both emissive so the
 * bloom pass makes them glow. At most a handful of anchors, so plain meshes
 * (no instancing) are fine and keep the pulse code simple.
 */
export default function Hotspots({
  anchors,
  color = '#ffb347',
  markers
}: {
  anchors?: [number, number, number][]
  color?: string
  markers?: { position: [number, number, number]; change: RehearsalReviewChange }[]
}): React.JSX.Element | null {
  if ((anchors?.length ?? 0) === 0 && (!markers || markers.length === 0)) return null
  return (
    <group>
      {anchors?.map((a, i) => (
        <Beacon key={i} position={a} phase={i * 0.7} color={color} />
      ))}
      {markers?.map((marker, i) => (
        <Beacon
          key={`review-${marker.position[0]}-${marker.position[2]}-${i}`}
          position={marker.position}
          phase={i * 0.7}
          color={reviewColor(marker.change)}
          change={marker.change}
        />
      ))}
    </group>
  )
}

function reviewColor(change: RehearsalReviewChange): string {
  if (change === 'added') return '#66d99a'
  if (change === 'deleted') return '#ff7070'
  if (change === 'renamed') return '#c995ff'
  if (change === 'typechange') return '#ffc266'
  return '#6ec8ff'
}

function Beacon({
  position,
  phase,
  color = '#ffb347',
  change
}: {
  position: [number, number, number]
  phase: number
  color?: string
  change?: RehearsalReviewChange
}): React.JSX.Element {
  const cone = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
  const ringMat = useRef<MeshBasicMaterial>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase
    if (cone.current) cone.current.position.y = 2.2 + Math.sin(t * 2) * 0.5
    // ring expands + fades on a ~1.6s loop
    const p = (t % 1.6) / 1.6
    if (ring.current) {
      const s = 0.4 + p * 2.4
      ring.current.scale.set(s, s, s)
    }
    if (ringMat.current) ringMat.current.opacity = (1 - p) * 0.5
  })

  const [x, y, z] = position
  return (
    <group position={[x, y, z]}>
      {/* bobbing marker cone (apex down) */}
      <group ref={cone} position={[0, 2.2, 0]}>
        <mesh rotation={[Math.PI, 0, 0]}>
          {change === 'deleted' ? (
            <sphereGeometry args={[0.72, 8, 4]} />
          ) : change === 'renamed' ? (
            <octahedronGeometry args={[0.8]} />
          ) : change === 'typechange' ? (
            <torusGeometry args={[0.52, 0.18, 8, 12]} />
          ) : (
            <coneGeometry args={[change === 'added' ? 0.85 : 0.7, 1.6, 5]} />
          )}
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} />
        </mesh>
      </group>
      {/* expanding halo ring at the rooftop */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
        <ringGeometry args={[0.75, 1.05, 24]} />
        <meshBasicMaterial
          ref={ringMat}
          color={color}
          toneMapped={false}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
