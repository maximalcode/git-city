import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { FileStatus } from '../../../shared/types'
import { isLiveState, useStore } from '../store'
import type { HeightSource, PlotSource } from './plots'

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
  return 'staged' // index side changed, worktree clean
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

interface Overlay {
  index: number
  kind: Kind
}

/**
 * Translucent, bloom-lit boxes around the files with uncommitted changes —
 * buildings in the city, fields on the farm. Only rendered in "live" mode
 * (viewing HEAD with a matching status); scrubbing the timeline hides the whole
 * layer. Conflicted files pulse.
 */
export default function StatusOverlay({
  model,
  targets,
  floor = 0.6
}: {
  model: PlotSource
  targets: HeightSource
  /** shortest the box may be, so a low crop still reads as marked */
  floor?: number
}): React.JSX.Element | null {
  const workingStatus = useStore((s) => s.workingStatus)
  const live = useStore(isLiveState)

  const overlays = useMemo<Overlay[]>(() => {
    if (!workingStatus) return []
    const out: Overlay[] = []
    for (const f of workingStatus.files) {
      const idx = model.indexOf.get(f.path.replace(/\\/g, '/'))
      if (idx === undefined) continue // new file with no plot → ConstructionSites handles it
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
    const pulse = 0.25 + 0.15 * Math.sin(t * 4)
    const breathe = 1 + 0.03 * Math.sin(t * 4)
    for (let i = 0; i < n; i++) {
      const o = overlays[i]
      const h = Math.max(targets.heights[o.index], floor)
      const { rect } = model.layout.plots[o.index]
      const m = 0.3
      const s = o.kind === 'conflict' ? breathe : 1
      dummy.position.set(rect.x + rect.w / 2, (h + m) / 2, rect.y + rect.h / 2)
      dummy.scale.set((rect.w + m) * s, h + m, (rect.h + m) * s)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, colorScratch.copy(colorFor(o.kind)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // pulse via a single shared opacity (conflicts dominate the visual anyway)
    const anyConflict = overlays.some((o) => o.kind === 'conflict')
    const mat = mesh.material as { opacity: number }
    mat.opacity = anyConflict ? pulse : 0.22
  })

  if (!live || n === 0) return null

  return (
    <instancedMesh key={n} ref={meshRef} args={[undefined, undefined, n]} frustumCulled={false}>
      <boxGeometry />
      <meshBasicMaterial transparent opacity={0.22} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  )
}
