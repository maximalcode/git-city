import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedMesh, Object3D } from 'three'
import { useStore } from '../store'
import { getTheme } from './themes'
import type { FleetModel } from '../layout/fleet'
import { shuttleGeometry } from './shipShapes'

const dummy = new Object3D()

interface Shuttle {
  from: number
  to: number
  t: number
  speed: number
  arc: number
  phase: number
}

/**
 * Inter-squadron shuttle traffic — the fleet's analog of city street traffic.
 * Glowing couriers ferry between squadron centers, spawned more often toward
 * busier squadrons (more files), so the liveliest folders get the busiest lanes.
 * One InstancedMesh; bloom turns the shuttles into little streaks.
 */
export default function Shuttles({ model }: { model: FleetModel }): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))
  const meshRef = useRef<InstancedMesh>(null!)
  const seed = useRef(7)
  const geometry = useMemo(() => shuttleGeometry(), [])

  // squadron centers + a cumulative weight table (weight = ship count)
  const nodes = useMemo(() => {
    const acc = new Map<number, { x: number; y: number; z: number; n: number }>()
    for (let i = 0; i < model.paths.length; i++) {
      const s = model.squadronOf[i]
      const a = acc.get(s) ?? { x: 0, y: 0, z: 0, n: 0 }
      a.x += model.positions[i * 3]
      a.y += model.positions[i * 3 + 1]
      a.z += model.positions[i * 3 + 2]
      a.n++
      acc.set(s, a)
    }
    const pos: [number, number, number][] = []
    const cumulative: number[] = []
    let total = 0
    for (const a of acc.values()) {
      pos.push([a.x / a.n, a.y / a.n, a.z / a.n])
      total += a.n
      cumulative.push(total)
    }
    return { pos, cumulative, total }
  }, [model])

  const count = Math.min(60, Math.max(6, nodes.pos.length * 2))

  const rand = (): number => {
    seed.current = ((seed.current * 1.618) % 1000) + 0.123
    return (((Math.sin(seed.current) * 43758.5453) % 1) + 1) % 1
  }
  const pick = (): number => {
    const target = rand() * nodes.total
    let lo = 0
    let hi = nodes.cumulative.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nodes.cumulative[mid] < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const respawn = (s: Shuttle): void => {
    s.from = pick()
    let to = pick()
    if (to === s.from) to = (to + 1) % nodes.pos.length
    s.to = to
    s.t = 0
    s.speed = 0.12 + rand() * 0.16
    s.arc = 4 + rand() * 10
    s.phase = rand() * Math.PI * 2
  }

  const pool = useMemo(() => {
    const arr: Shuttle[] = []
    if (nodes.pos.length < 2) return arr
    for (let i = 0; i < count; i++) {
      const s: Shuttle = { from: 0, to: 1, t: 0, speed: 0.15, arc: 6, phase: 0 }
      respawn(s)
      s.t = i / count // stagger so they don't all launch together
      arr.push(s)
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, count])

  useFrame((_, dt) => {
    const mesh = meshRef.current
    if (!mesh || pool.length === 0) return
    const step = Math.min(dt, 0.05)
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i]
      s.t += step * s.speed
      if (s.t >= 1) respawn(s)
      const a = nodes.pos[s.from]
      const b = nodes.pos[s.to]
      const k = s.t
      const x = a[0] + (b[0] - a[0]) * k
      const z = a[2] + (b[2] - a[2]) * k
      // parabolic arc up and back down over the trip
      const y = a[1] + (b[1] - a[1]) * k + Math.sin(k * Math.PI) * s.arc
      const dx = b[0] - a[0]
      const dz = b[2] - a[2]
      const yaw = Math.atan2(dz, dx)
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, -yaw, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (nodes.pos.length < 2) return null

  return (
    <instancedMesh
      key={count}
      ref={meshRef}
      args={[geometry, undefined, count]}
      frustumCulled={false}
    >
      <meshBasicMaterial color={theme.windows.color} toneMapped={false} />
    </instancedMesh>
  )
}
