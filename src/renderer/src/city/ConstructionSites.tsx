import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { InstancedMesh, Object3D } from 'three'
import { isLiveState, useStore } from '../store'

const dummy = new Object3D()

/**
 * Untracked/added files that don't yet have a plot in the (stable) layout appear
 * as low blue wireframe boxes on a grid strip past the world's +Z edge — so
 * brand-new files are visible without triggering a relayout.
 *
 * A marked-out plot with nothing on it yet reads the same on a farm as in a
 * city, so both worlds use this; all it needs is the world's extent to know
 * where its edge is.
 */
export default function ConstructionSites({
  model,
  size
}: {
  model: { indexOf: Map<string, number> }
  /** world extent — citySize in the city, worldSize on the farm */
  size: number
}): React.JSX.Element | null {
  const workingStatus = useStore((s) => s.workingStatus)
  const live = useStore(isLiveState)
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)

  const sites = useMemo<string[]>(() => {
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
  const n = sites.length

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh || n === 0) return
    const pulse = 0.35 + 0.1 * Math.sin(state.clock.elapsedTime * 2)
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
    const gap = 3
    const z0 = size / 2 + 6
    const x0 = -((cols - 1) * gap) / 2
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      dummy.position.set(x0 + c * gap, 0.8, z0 + r * gap)
      dummy.scale.set(2, 1.6, 2)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    ;(mesh.material as { opacity: number }).opacity = pulse
  })

  if (!live || n === 0) return null

  const pathAt = (e: ThreeEvent<PointerEvent | MouseEvent>): string | null =>
    e.instanceId === undefined ? null : sites[e.instanceId]

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
      <boxGeometry />
      <meshBasicMaterial color="#6ec8ff" transparent opacity={0.35} toneMapped={false} wireframe />
    </instancedMesh>
  )
}
