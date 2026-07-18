import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { FileStatus } from '../../../shared/types'
import { isLiveState, useStore } from '../store'
import { ALTITUDE_BASE, SHIP_CLASS, type FleetModel, type FleetTargets } from '../layout/fleet'

const dummy = new Object3D()
const colorScratch = new Color()

const C_UNTRACKED = new Color('#6ec8ff')
const C_MODIFIED = new Color('#ffb347')
const C_STAGED = new Color('#7dd87d')
const C_CONFLICT = new Color('#ff6b6b')

type Kind = 'untracked' | 'modified' | 'staged' | 'conflict'

function kindOf(f: FileStatus): Kind {
  if (f.conflicted) return 'conflict'
  if (f.worktree === 'modified' || f.worktree === 'deleted' || f.worktree === 'typechange')
    return 'modified'
  if (f.worktree === 'untracked' || f.worktree === 'added') return 'untracked'
  return 'staged'
}

function colorFor(kind: Kind): Color {
  switch (kind) {
    case 'untracked':
      return C_UNTRACKED
    case 'modified':
      return C_MODIFIED
    case 'staged':
      return C_STAGED
    case 'conflict':
      return C_CONFLICT
  }
}

/** shield radius per ship class */
const SHIELD_R: Record<number, number> = {
  [SHIP_CLASS.fighter]: 2.2,
  [SHIP_CLASS.freighter]: 3.0,
  [SHIP_CLASS.capital]: 4.6
}

/**
 * Fleet analog of StatusOverlay: ships whose files have uncommitted changes
 * raise a translucent pulsing "shield" bubble. Live mode only.
 */
export function FleetStatusOverlay({
  model,
  targets
}: {
  model: FleetModel
  targets: FleetTargets
}): React.JSX.Element | null {
  const workingStatus = useStore((s) => s.workingStatus)
  const live = useStore(isLiveState)

  const overlays = useMemo<{ index: number; kind: Kind }[]>(() => {
    if (!workingStatus) return []
    const out: { index: number; kind: Kind }[] = []
    for (const f of workingStatus.files) {
      const idx = model.indexOf.get(f.path.replace(/\\/g, '/'))
      if (idx === undefined) continue // new file with no ship → FleetArrivals handles it
      out.push({ index: idx, kind: kindOf(f) })
    }
    return out
  }, [workingStatus, model])

  const meshRef = useRef<InstancedMesh>(null!)
  const n = overlays.length

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh || n === 0) return
    const t = state.clock.elapsedTime
    const pulse = 0.18 + 0.1 * Math.sin(t * 4)
    for (let i = 0; i < n; i++) {
      const o = overlays[i]
      const present = targets.scales[o.index] > 0.05
      const r = present ? SHIELD_R[model.classes[o.index]] : 0.001
      const breathe = o.kind === 'conflict' ? 1 + 0.06 * Math.sin(t * 4) : 1
      dummy.position.set(
        model.positions[o.index * 3],
        model.positions[o.index * 3 + 1],
        model.positions[o.index * 3 + 2]
      )
      dummy.scale.setScalar(r * breathe)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, colorScratch.copy(colorFor(o.kind)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    const anyConflict = overlays.some((o) => o.kind === 'conflict')
    ;(mesh.material as { opacity: number }).opacity = anyConflict ? pulse : 0.14
  })

  if (!live || n === 0) return null

  return (
    <instancedMesh key={n} ref={meshRef} args={[undefined, undefined, n]} frustumCulled={false}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial transparent opacity={0.14} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  )
}

/**
 * Fleet analog of ConstructionSites: brand-new files without a ship hold
 * formation as wireframe octahedra beyond the fleet's +Z edge, waiting to
 * be commissioned.
 */
export function FleetArrivals({ model }: { model: FleetModel }): React.JSX.Element | null {
  const workingStatus = useStore((s) => s.workingStatus)
  const live = useStore(isLiveState)
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)

  const arrivals = useMemo<string[]>(() => {
    if (!workingStatus) return []
    return workingStatus.files
      .filter(
        (f) =>
          (f.worktree === 'untracked' || f.worktree === 'added' || f.index === 'added') &&
          model.indexOf.get(f.path.replace(/\\/g, '/')) === undefined
      )
      .map((f) => f.path)
  }, [workingStatus, model])

  const meshRef = useRef<InstancedMesh>(null!)
  const n = arrivals.length

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh || n === 0) return
    const t = state.clock.elapsedTime
    const pulse = 0.4 + 0.15 * Math.sin(t * 2)
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
    const gap = 4
    const z0 = model.worldSize / 2 + 10
    const x0 = -((cols - 1) * gap) / 2
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const bob = Math.sin(t * 0.8 + i) * 0.5
      dummy.position.set(x0 + c * gap, ALTITUDE_BASE + bob, z0 + r * gap)
      dummy.scale.setScalar(1.1)
      dummy.rotation.set(0, t * 0.4 + i, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    ;(mesh.material as { opacity: number }).opacity = pulse
  })

  if (!live || n === 0) return null

  const pathAt = (e: ThreeEvent<PointerEvent | MouseEvent>): string | null =>
    e.instanceId === undefined ? null : arrivals[e.instanceId]

  return (
    <instancedMesh
      key={n}
      ref={meshRef}
      args={[undefined, undefined, n]}
      frustumCulled={false}
      onPointerMove={(e) => {
        e.stopPropagation()
        setHovered(pathAt(e))
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(e) => {
        e.stopPropagation()
        const p = pathAt(e)
        if (p) setSelected(p)
      }}
    >
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#6ec8ff" transparent opacity={0.4} toneMapped={false} wireframe />
    </instancedMesh>
  )
}

/**
 * Fleet analog of Highlight: a soft glowing bubble around the hovered /
 * selected ship.
 */
export function FleetHighlight({
  model,
  targets
}: {
  model: FleetModel
  targets: FleetTargets
}): React.JSX.Element | null {
  const hovered = useStore((s) => s.hovered)
  const selected = useStore((s) => s.selected)
  const path = selected ?? hovered
  const index = path != null ? model.indexOf.get(path) : undefined

  if (index === undefined || targets.scales[index] <= 0.05) return null

  const r = SHIELD_R[model.classes[index]] * 0.85
  return (
    <mesh
      position={[
        model.positions[index * 3],
        model.positions[index * 3 + 1],
        model.positions[index * 3 + 2]
      ]}
    >
      <sphereGeometry args={[r, 20, 14]} />
      <meshBasicMaterial
        color={selected ? '#ffffff' : '#9ecbff'}
        transparent
        opacity={selected ? 0.22 : 0.12}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  )
}
