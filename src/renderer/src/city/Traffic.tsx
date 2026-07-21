import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { Snapshot } from '../../../shared/types'
import { useStore } from '../store'
import { getTheme, type Theme } from './themes'
import type { CityModel } from './cityData'
import { roadY } from './roadGeometry'
import { LANE_OFFSET_CAP } from './streetFurniture'
import { geometryFor, type AgentKind } from './trafficShapes'

const dummy = new Object3D()

interface LayerSpec {
  kind: AgentKind
  count: number
  material: 'lit' | 'glow'
  palette: string[]
  color: string
  hover: number // hover height above the road (0 = on the asphalt)
  /** cruise speed in world units per second */
  speed: number
  spin: boolean
  /** narrowest street this agent kind fits on (0 = any) */
  minWidth: number
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
const BIKE_COLORS = ['#dfe6e9', '#74b9ff', '#ffeaa7', '#fab1a0']

function layersForTheme(theme: Theme, nEdges: number): LayerSpec[] {
  if (theme.particles === 'none' || nEdges < 1) return []
  const base = Math.min(80, Math.max(8, Math.floor(nEdges * 0.4)))
  if (theme.id === 'neon') {
    return [
      {
        kind: 'futuristic',
        count: Math.floor(base * 0.7),
        material: 'glow',
        palette: [],
        color: theme.dirFill.color,
        hover: 4,
        speed: 4.5,
        spin: true,
        minWidth: 0
      }
    ]
  }
  // a realistic mix: mostly cars, some wagons, fewer vans, a couple of buses
  const mix: [AgentKind, number, number, number][] = [
    // kind, share of `base`, speed, min street width
    ['car', 0.36, 3.2, 1.3],
    ['wagon', 0.2, 3.0, 1.3],
    ['van', 0.1, 2.6, 1.5],
    ['bus', 0.05, 2.2, 2.2]
  ]
  return [
    ...mix.map(([kind, share, speed, minWidth]) => ({
      kind,
      count: Math.max(1, Math.floor(base * share)),
      material: 'lit' as const,
      palette: CAR_COLORS,
      color: '#fff',
      hover: 0,
      speed,
      spin: false,
      minWidth
    })),
    {
      kind: 'bike',
      count: Math.floor(base * 0.25),
      material: 'lit',
      palette: BIKE_COLORS,
      color: '#fff',
      hover: 0,
      speed: 1.6,
      spin: false,
      minWidth: 0.7
    }
  ]
}

/**
 * Street traffic: cars and bikes (hovercraft in Neon) driving along the road
 * graph — lane-offset to the right of travel, steering through junctions, and
 * periodically respawning onto streets weighted by the nearest building's
 * commit count, so the busiest code gets the busiest streets.
 */
export default function Traffic({
  model,
  snapshot
}: {
  model: CityModel
  snapshot: Snapshot
}): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))
  const graph = model.roadGraph

  // nearest plot per edge midpoint — static per model, feeds commit weighting
  const nearestPlot = useMemo(() => {
    const out = new Int32Array(graph.edges.length)
    const plots = model.layout.plots
    for (let ei = 0; ei < graph.edges.length; ei++) {
      const e = graph.edges[ei]
      const mx = (graph.nodes[e.a].x + graph.nodes[e.b].x) / 2
      const mz = (graph.nodes[e.a].z + graph.nodes[e.b].z) / 2
      let best = 0
      let bestD = Infinity
      for (let pi = 0; pi < plots.length; pi++) {
        const r = plots[pi].rect
        const dx = r.x + r.w / 2 - mx
        const dz = r.y + r.h / 2 - mz
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = pi
        }
      }
      out[ei] = best
    }
    return out
  }, [model, graph])

  const layers = useMemo(() => layersForTheme(theme, graph.edges.length), [theme, graph])
  if (graph.edges.length === 0 || layers.length === 0) return null

  return (
    <>
      {layers.map((spec) => (
        <AgentLayer
          key={spec.kind}
          spec={spec}
          model={model}
          snapshot={snapshot}
          nearestPlot={nearestPlot}
        />
      ))}
    </>
  )
}

interface Agent {
  edge: number
  /** distance from node `a` along the edge, in world units */
  s: number
  dir: 1 | -1
  speed: number
  angle: number
  phase: number
  /** seconds until this agent respawns on a freshly-weighted street */
  ttl: number
}

function AgentLayer({
  spec,
  model,
  snapshot,
  nearestPlot
}: {
  spec: LayerSpec
  model: CityModel
  snapshot: Snapshot
  nearestPlot: Int32Array
}): React.JSX.Element | null {
  const geometry = useMemo(() => geometryFor(spec.kind), [spec.kind])
  const graph = model.roadGraph
  const seed = useRef(1)
  const agentScale = Math.min(1, model.citySize / 140)

  const rand = (): number => {
    seed.current = ((seed.current * 1.618) % 1000) + 0.123
    return (((Math.sin(seed.current) * 43758.5453) % 1) + 1) % 1
  }

  // streets this agent kind fits on
  const edgeIdx = useMemo(
    () => graph.edges.map((_, i) => i).filter((i) => graph.edges[i].width >= spec.minWidth),
    [graph, spec.minWidth]
  )

  // commit-weighted spawn distribution over those streets (per snapshot)
  const spawnRef = useRef<{ cumulative: number[]; total: number }>({ cumulative: [], total: 0 })
  spawnRef.current = useMemo(() => {
    const byPath = new Map(snapshot.files.map((f) => [f.path, f]))
    const cumulative: number[] = []
    let total = 0
    for (const ei of edgeIdx) {
      const f = byPath.get(model.paths[nearestPlot[ei]])
      total += f ? 1 + f.commits : 0.2
      cumulative.push(total)
    }
    return { cumulative, total }
  }, [snapshot, edgeIdx, model, nearestPlot])

  const pickEdge = (): number => {
    const { cumulative, total } = spawnRef.current
    const target = rand() * total
    let lo = 0
    let hi = cumulative.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cumulative[mid] < target) lo = mid + 1
      else hi = mid
    }
    return edgeIdx[lo]
  }

  const edgeAngle = (edge: number, dir: 1 | -1): number => {
    const e = graph.edges[edge]
    const dx = (graph.nodes[e.b].x - graph.nodes[e.a].x) * dir
    const dz = (graph.nodes[e.b].z - graph.nodes[e.a].z) * dir
    return Math.atan2(dz, dx)
  }

  const respawn = (a: Agent): void => {
    a.edge = pickEdge()
    a.dir = rand() < 0.5 ? 1 : -1
    a.s = rand() * graph.edges[a.edge].length
    a.speed = spec.speed * (0.7 + rand() * 0.6)
    a.angle = edgeAngle(a.edge, a.dir)
    a.ttl = 6 + rand() * 14
  }

  const pool = useMemo(() => {
    const arr: Agent[] = []
    if (edgeIdx.length === 0) return arr
    for (let i = 0; i < spec.count; i++) {
      const a: Agent = {
        edge: 0,
        s: 0,
        dir: 1,
        speed: spec.speed,
        angle: 0,
        phase: (i * 1.37) % (Math.PI * 2),
        ttl: 10
      }
      respawn(a)
      arr.push(a)
    }
    return arr
    // spawn distribution updates via spawnRef; the pool itself must survive
    // snapshot changes or every agent would teleport on each playback step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, edgeIdx])

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

  // At a junction, keep going: prefer any edge other than the one we came in
  // on (dead ends turn back). Returns false if the node has no usable edges.
  const advance = (a: Agent): boolean => {
    const e = graph.edges[a.edge]
    const node = a.dir === 1 ? e.b : e.a
    const options = graph.adjacency[node].filter(
      (ei) => ei !== a.edge && graph.edges[ei].width >= spec.minWidth
    )
    const next =
      options.length > 0 ? options[Math.floor(rand() * options.length) % options.length] : a.edge
    a.edge = next
    a.dir = graph.edges[next].a === node ? 1 : -1
    a.s = a.dir === 1 ? 0 : graph.edges[next].length
    return true
  }

  useFrame((state, dt) => {
    const mesh = meshRef.current
    if (!mesh || pool.length === 0) return
    const step = Math.min(dt, 0.05)
    const t = state.clock.elapsedTime
    const steer = 1 - Math.exp(-10 * step)
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i]
      a.ttl -= step
      if (a.ttl <= 0) respawn(a)
      const e = graph.edges[a.edge]
      a.s += a.dir * a.speed * step
      if (a.s < 0 || a.s > e.length) advance(a)
      const cur = graph.edges[a.edge]
      const na = graph.nodes[cur.a]
      const nb = graph.nodes[cur.b]
      const k = cur.length > 0 ? a.s / cur.length : 0
      let x = na.x + (nb.x - na.x) * k
      let z = na.z + (nb.z - na.z) * k
      // right-hand lane offset so opposing traffic never overlaps; capped so
      // cars keep to the inner lanes of wide boulevards (outer strip parks)
      const target = edgeAngle(a.edge, a.dir)
      const laneOff = Math.min(cur.width * 0.22, LANE_OFFSET_CAP) * agentScale
      x += Math.sin(target) * laneOff
      z += -Math.cos(target) * laneOff
      // steer smoothly toward the street direction (junction turns)
      let delta = target - a.angle
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI
      if (delta < -Math.PI) delta += Math.PI * 2
      a.angle += delta * steer
      const bob = spec.hover > 0 ? Math.sin(t * 2 + a.phase) * 0.4 : 0
      dummy.position.set(x, roadY(cur.depth) + spec.hover + bob, z)
      dummy.rotation.set(0, spec.spin ? t * 1.5 + a.phase : -a.angle, 0)
      dummy.scale.setScalar(agentScale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (spec.count === 0 || edgeIdx.length === 0) return null

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
        <meshStandardMaterial roughness={0.5} metalness={0.1} vertexColors />
      )}
    </instancedMesh>
  )
}
