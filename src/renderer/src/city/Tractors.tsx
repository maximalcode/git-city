import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedMesh, Object3D } from 'three'
import type { FarmModel } from '../layout/farm'
import { useStore } from '../store'
import { tractorCount, tractorGeometry } from './farmShapes'

const dummy = new Object3D()

interface Tractor {
  edge: number
  /** distance along the edge from its `a` node, in world units */
  s: number
  dir: 1 | -1
  speed: number
  angle: number
}

/**
 * Tractors working the dirt tracks.
 *
 * The farm reused the city's road graph from the beginning and then left it
 * completely empty. The city's streets carry commit-weighted traffic, and that
 * motion is a large part of why it reads as a place rather than a diagram —
 * the tracks needed something for the same reason (#52).
 *
 * Deliberately much simpler than Traffic: no commit weighting, no respawn
 * cycling, no per-kind layers. A working farm has a tractor or two, not a rush
 * hour, so the density is a twentieth of the city's and the whole thing is one
 * instanced draw.
 */
export default function Tractors({ model }: { model: FarmModel }): React.JSX.Element | null {
  const reduceMotion = useStore((s) => s.reduceMotion)
  const meshRef = useRef<InstancedMesh>(null!)
  const graph = model.roadGraph

  const geometry = useMemo(() => tractorGeometry(), [])
  useLayoutEffect(() => () => geometry.dispose(), [geometry])

  const count = tractorCount(graph.edges.length)

  const pool = useMemo(() => {
    const arr: Tractor[] = []
    if (graph.edges.length === 0) return arr
    // Deterministic placement — the same repository puts its tractors in the
    // same places every time, like every other part of this layout.
    for (let i = 0; i < count; i++) {
      const edge = Math.floor((i * 7919) % graph.edges.length)
      const e = graph.edges[edge]
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1
      const a = graph.nodes[e.a]
      const b = graph.nodes[e.b]
      arr.push({
        edge,
        s: ((i * 13.7) % 1) * e.length,
        dir,
        // a tractor is slow, and looking slow is most of what sells it
        speed: 1.1 + ((i * 0.37) % 1) * 0.5,
        angle: Math.atan2((b.z - a.z) * dir, (b.x - a.x) * dir)
      })
    }
    return arr
  }, [graph, count])

  /** At a junction pick any track other than the one we arrived on. */
  const advance = (t: Tractor, pick: number): void => {
    const e = graph.edges[t.edge]
    const node = t.dir === 1 ? e.b : e.a
    const options = graph.adjacency[node].filter((ei) => ei !== t.edge)
    const next = options.length > 0 ? options[pick % options.length] : t.edge
    t.edge = next
    t.dir = graph.edges[next].a === node ? 1 : -1
    t.s = t.dir === 1 ? 0 : graph.edges[next].length
  }

  useFrame((state, dt) => {
    const mesh = meshRef.current
    if (!mesh || pool.length === 0) return
    // Reduce motion parks them rather than removing them, as the city does:
    // the tracks keep their tractors, they just stop pulling the eye.
    const step = reduceMotion ? 0 : Math.min(dt, 0.05)
    const steer = 1 - Math.exp(-8 * step)

    for (let i = 0; i < pool.length; i++) {
      const t = pool[i]
      const e = graph.edges[t.edge]
      t.s += t.dir * t.speed * step
      if (t.s < 0 || t.s > e.length) {
        advance(t, Math.floor(state.clock.elapsedTime + i) % 7)
      }
      const cur = graph.edges[t.edge]
      const a = graph.nodes[cur.a]
      const b = graph.nodes[cur.b]
      const u = cur.length === 0 ? 0 : t.s / cur.length
      const x = a.x + (b.x - a.x) * u
      const z = a.z + (b.z - a.z) * u

      const want = Math.atan2((b.z - a.z) * t.dir, (b.x - a.x) * t.dir)
      // shortest-way turn, so a tractor never spins the long way round a corner
      let delta = want - t.angle
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      t.angle += delta * steer

      // offset to the right of travel, so two tractors pass rather than collide
      const off = 0.35
      dummy.position.set(x + Math.sin(t.angle) * off, 0, z - Math.cos(t.angle) * off)
      dummy.rotation.set(0, -t.angle, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (pool.length === 0) return null
  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, pool.length]} castShadow>
      <meshStandardMaterial vertexColors roughness={0.72} metalness={0.15} />
    </instancedMesh>
  )
}
