import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { Snapshot } from '../../../shared/types'
import { useStore } from '../store'
import { getTheme, type Theme } from './themes'
import type { CityModel } from './cityData'
import { geometryFor, type AgentKind } from './trafficShapes'

const dummy = new Object3D()

interface Nodes {
  pos: [number, number][]
  cumulative: number[]
  total: number
}

interface LayerSpec {
  kind: AgentKind
  count: number
  material: 'lit' | 'glow'
  palette: string[]
  color: string
  hover: number // hover height (0 = ground)
  speed: number
  spin: boolean
}

const CAR_COLORS = [
  '#e74c3c',
  '#3498db',
  '#f1c40f',
  '#2ecc71',
  '#ecf0f1',
  '#e67e22',
  '#e84393',
  '#00cec9'
]
const PERSON_COLORS = ['#d6a06a', '#c98b5e', '#e8c39e', '#8d5524', '#5b7fb4', '#b25f6e']
const BIKE_COLORS = ['#dfe6e9', '#74b9ff', '#ffeaa7', '#fab1a0']

function layersForTheme(theme: Theme, nNodes: number): LayerSpec[] {
  if (theme.particles === 'none' || nNodes < 2) return []
  const base = Math.min(80, Math.max(8, Math.floor(nNodes * 1.1)))
  if (theme.id === 'neon') {
    return [
      {
        kind: 'futuristic',
        count: Math.floor(base * 0.7),
        material: 'glow',
        palette: [],
        color: theme.dirFill.color,
        hover: 4,
        speed: 0.7,
        spin: true
      }
    ]
  }
  return [
    {
      kind: 'car',
      count: Math.floor(base * 0.55),
      material: 'lit',
      palette: CAR_COLORS,
      color: '#fff',
      hover: 0,
      speed: 0.5,
      spin: false
    },
    {
      kind: 'person',
      count: Math.floor(base * 0.3),
      material: 'lit',
      palette: PERSON_COLORS,
      color: '#fff',
      hover: 0,
      speed: 0.24,
      spin: false
    },
    {
      kind: 'bike',
      count: Math.floor(base * 0.15),
      material: 'lit',
      palette: BIKE_COLORS,
      color: '#fff',
      hover: 0,
      speed: 0.34,
      spin: false
    }
  ]
}

/**
 * Activity-driven traffic: little cars, people and bikes (or futuristic
 * hover-craft in Neon) travelling short local trips between buildings, spawned
 * with probability proportional to each file's commit count — the busiest code
 * gets the busiest streets. One InstancedMesh per agent kind.
 */
export default function Traffic({
  model,
  snapshot
}: {
  model: CityModel
  snapshot: Snapshot
}): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))

  const nodes = useMemo<Nodes>(() => {
    const pos: [number, number][] = []
    const cumulative: number[] = []
    let total = 0
    const byPath = new Map(snapshot.files.map((f) => [f.path, f]))
    for (let i = 0; i < model.paths.length; i++) {
      const f = byPath.get(model.paths[i])
      if (!f) continue
      const plot = model.layout.plots[i]
      total += 1 + f.commits
      pos.push([plot.rect.x + plot.rect.w / 2, plot.rect.y + plot.rect.h / 2])
      cumulative.push(total)
    }
    return { pos, cumulative, total }
  }, [model, snapshot])

  const layers = useMemo(() => layersForTheme(theme, nodes.pos.length), [theme, nodes.pos.length])
  if (nodes.pos.length < 2) return null

  return (
    <>
      {layers.map((spec) => (
        <AgentLayer key={spec.kind} spec={spec} nodes={nodes} />
      ))}
    </>
  )
}

interface Agent {
  from: number
  to: number
  t: number
  speed: number
  phase: number
}

function AgentLayer({ spec, nodes }: { spec: LayerSpec; nodes: Nodes }): React.JSX.Element | null {
  const geometry = useMemo(() => geometryFor(spec.kind), [spec.kind])
  const seed = useRef(1)

  const pick = (): number => {
    seed.current = ((seed.current * 1.618) % 1000) + 0.123
    const r = (((Math.sin(seed.current) * 43758.5453) % 1) + 1) % 1
    const target = r * nodes.total
    let lo = 0
    let hi = nodes.cumulative.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nodes.cumulative[mid] < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  const dist2 = (a: number, b: number): number => {
    const dx = nodes.pos[a][0] - nodes.pos[b][0]
    const dz = nodes.pos[a][1] - nodes.pos[b][1]
    return dx * dx + dz * dz
  }

  const respawn = (agent: Agent): void => {
    agent.from = pick()
    // destination = nearest of a few weighted candidates → short, local, street-like trips
    let best = -1
    let bestD = Infinity
    for (let k = 0; k < 4; k++) {
      const c = pick()
      if (c === agent.from) continue
      const d = dist2(agent.from, c)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    agent.to = best >= 0 ? best : (agent.from + 1) % nodes.pos.length
    agent.t = 0
    agent.speed = spec.speed * (0.7 + ((Math.sin(seed.current * 7.7) + 1) / 2) * 0.6)
  }

  const pool = useMemo(() => {
    const arr: Agent[] = []
    for (let i = 0; i < spec.count; i++) {
      const a: Agent = {
        from: 0,
        to: 1,
        t: 0,
        speed: spec.speed,
        phase: (i * 1.37) % (Math.PI * 2)
      }
      respawn(a)
      a.t = i / Math.max(1, spec.count)
      arr.push(a)
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, nodes])

  const meshRef = useRef<InstancedMesh>(null!)

  // per-instance paint colors (set once)
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh || spec.material !== 'lit' || spec.palette.length === 0) return
    const c = new Color()
    for (let i = 0; i < pool.length; i++) {
      mesh.setColorAt(i, c.set(spec.palette[i % spec.palette.length]))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [pool, spec])

  useFrame((state, dt) => {
    const mesh = meshRef.current
    if (!mesh || pool.length === 0) return
    const step = Math.min(dt, 0.05)
    const t = state.clock.elapsedTime
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i]
      a.t += step * a.speed
      if (a.t >= 1) respawn(a)
      const from = nodes.pos[a.from]
      const to = nodes.pos[a.to]
      if (!from || !to) continue
      const x = from[0] + (to[0] - from[0]) * a.t
      const z = from[1] + (to[1] - from[1]) * a.t
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
      const bob = spec.hover > 0 ? Math.sin(t * 2 + a.phase) * 0.4 : 0
      dummy.position.set(x, spec.hover + bob, z)
      dummy.rotation.set(0, spec.spin ? t * 1.5 + a.phase : -angle, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (spec.count === 0) return null

  return (
    <instancedMesh
      key={spec.count}
      ref={meshRef}
      args={[geometry, undefined, spec.count]}
      frustumCulled={false}
      castShadow={spec.material === 'lit'}
    >
      {spec.material === 'glow' ? (
        <meshBasicMaterial color={spec.color} toneMapped={false} />
      ) : (
        <meshStandardMaterial roughness={0.5} metalness={0.1} />
      )}
    </instancedMesh>
  )
}
