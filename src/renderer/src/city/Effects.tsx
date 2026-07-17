import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, MeshBasicMaterial } from 'three'
import { useStore, type EffectKind } from '../store'

/**
 * Transient, playful feedback for git operations. Each effect runs once per
 * store `effect.nonce` bump and unmounts when its clock runs out. All use
 * meshBasicMaterial toneMapped={false} so the existing Bloom pass makes them glow.
 */
export default function Effects({ citySize }: { citySize: number }): React.JSX.Element | null {
  const effect = useStore((s) => s.effect)
  const [active, setActive] = useState<{ kind: EffectKind; nonce: number } | null>(null)

  useEffect(() => {
    if (effect) setActive(effect)
  }, [effect])

  if (!active) return null

  const done = (): void => setActive(null)
  if (active.kind === 'commit-settle')
    return <SettleRing key={active.nonce} citySize={citySize} onDone={done} />
  return (
    <Beam
      key={active.nonce}
      citySize={citySize}
      direction={active.kind === 'push' ? 'up' : 'down'}
      color={active.kind === 'push' ? '#ffb347' : '#6ec8ff'}
      onDone={done}
    />
  )
}

const SETTLE_MS = 900

function SettleRing({
  citySize,
  onDone
}: {
  citySize: number
  onDone: () => void
}): React.JSX.Element {
  const ref = useRef<Mesh>(null!)
  const start = useRef<number | null>(null)

  useFrame((state) => {
    if (start.current === null) start.current = state.clock.elapsedTime
    const t = (state.clock.elapsedTime - start.current) * 1000
    const k = Math.min(t / SETTLE_MS, 1)
    const mesh = ref.current
    if (mesh) {
      const s = 0.1 + k * citySize * 1.4
      mesh.scale.set(s, s, s)
      ;(mesh.material as MeshBasicMaterial).opacity = (1 - k) * 0.6
    }
    if (k >= 1) onDone()
  })

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
      <ringGeometry args={[0.82, 1, 64]} />
      <meshBasicMaterial
        color="#ffd27a"
        transparent
        opacity={0.6}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  )
}

const BEAM_MS = 1200

function Beam({
  citySize,
  direction,
  color,
  onDone
}: {
  citySize: number
  direction: 'up' | 'down'
  color: string
  onDone: () => void
}): React.JSX.Element {
  const packet = useRef<Mesh>(null!)
  const column = useRef<Mesh>(null!)
  const start = useRef<number | null>(null)
  const top = citySize * 0.9

  useFrame((state) => {
    if (start.current === null) start.current = state.clock.elapsedTime
    const t = (state.clock.elapsedTime - start.current) * 1000
    const k = Math.min(t / BEAM_MS, 1)
    const y = direction === 'up' ? k * top : (1 - k) * top
    if (packet.current) packet.current.position.y = y + 1
    if (column.current) {
      const fade = Math.sin(k * Math.PI) // in then out
      ;(column.current.material as MeshBasicMaterial).opacity = fade * 0.35
    }
    if (k >= 1) onDone()
  })

  return (
    <group>
      <mesh ref={column} position={[0, top / 2, 0]}>
        <cylinderGeometry args={[0.6, 0.6, top, 12, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={packet} position={[0, 1, 0]}>
        <boxGeometry args={[2.2, 2.2, 2.2]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  )
}
