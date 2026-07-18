import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import { useStore } from '../store'
import { getTheme } from './themes'
import type { ForestModel, ForestTargets } from '../layout/forest'
import { TREE_KINDS, foliageGeometry, trunkGeometry } from './treeShapes'

const dummy = new Object3D()
const colorScratch = new Color()

/** Below this scale a tree counts as "not there" for interactions. */
const MIN_VISIBLE = 0.05

/**
 * The forest: per size class one trunk InstancedMesh (brown) + one foliage
 * InstancedMesh (colour-mode tinted). Scale grows in from 0 as files appear and
 * breathes with the live line count; a gentle wind sway keeps the canopy alive.
 * Picking runs off the foliage (the big target) so hover/click/fly-to work just
 * like clicking a building.
 */
export default function Trees({
  model,
  targets
}: {
  model: ForestModel
  targets: ForestTargets
}): React.JSX.Element {
  const n = model.paths.length
  const anim = useMemo(
    () => ({
      scales: new Float32Array(n), // start at 0 → forest grows in on load
      colors: new Float32Array(targets.colors),
      settledColors: false
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model]
  )
  useEffect(() => {
    anim.settledColors = false
  }, [targets, anim])

  return (
    <group>
      {TREE_KINDS.map((_, k) => (
        <KindLayer key={k} kindIndex={k} model={model} targets={targets} anim={anim} />
      ))}
    </group>
  )
}

interface Anim {
  scales: Float32Array
  colors: Float32Array
  settledColors: boolean
}

function KindLayer({
  kindIndex,
  model,
  targets,
  anim
}: {
  kindIndex: number
  model: ForestModel
  targets: ForestTargets
  anim: Anim
}): React.JSX.Element | null {
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)
  const theme = getTheme(useStore((s) => s.themeId))

  const kind = TREE_KINDS[kindIndex]
  const trunkGeo = useMemo(() => trunkGeometry(kind), [kind])
  const foliageGeo = useMemo(() => foliageGeometry(kind), [kind])

  const trees = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < model.kinds.length; i++) if (model.kinds[i] === kindIndex) out.push(i)
    return out
  }, [model, kindIndex])

  const trunkRef = useRef<InstancedMesh>(null!)
  const foliageRef = useRef<InstancedMesh>(null!)
  const count = trees.length

  useFrame((state, dt) => {
    const trunk = trunkRef.current
    const foliage = foliageRef.current
    if (!trunk || !foliage || count === 0) return
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * theme.lerpSpeed)
    const lerpColors = !anim.settledColors
    let maxColorDelta = 0

    for (let s = 0; s < count; s++) {
      const i = trees[s]
      const ts = targets.scales[i]
      const cs = anim.scales[i]
      const ns = cs + (ts - cs) * k
      anim.scales[i] = ns

      if (lerpColors) {
        for (let ci = 0; ci < 3; ci++) {
          const idx = i * 3 + ci
          const cc = anim.colors[idx]
          const tc = targets.colors[idx]
          const nc = cc + (tc - cc) * k
          anim.colors[idx] = nc
          const d = Math.abs(tc - nc)
          if (d > maxColorDelta) maxColorDelta = d
        }
        foliage.setColorAt(
          s,
          colorScratch.setRGB(anim.colors[i * 3], anim.colors[i * 3 + 1], anim.colors[i * 3 + 2])
        )
      }

      const phase = (i * 1.37) % (Math.PI * 2)
      const x = model.positions[i * 3]
      const z = model.positions[i * 3 + 2]
      const sway = Math.sin(t * 0.7 + phase) * 0.025 // wind
      const sc = Math.max(ns, 0.001)

      dummy.position.set(x, 0, z)
      dummy.rotation.set(0, phase + sway, sway * 0.6)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      trunk.setMatrixAt(s, dummy.matrix)
      foliage.setMatrixAt(s, dummy.matrix)
    }

    trunk.instanceMatrix.needsUpdate = true
    foliage.instanceMatrix.needsUpdate = true
    if (lerpColors && foliage.instanceColor) foliage.instanceColor.needsUpdate = true
    if (lerpColors && maxColorDelta < 0.002) anim.settledColors = true
  })

  if (count === 0) return null

  const pathAt = (id: number | undefined): string | null => {
    if (id === undefined) return null
    const i = trees[id]
    return anim.scales[i] < MIN_VISIBLE ? null : model.paths[i]
  }
  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation()
    setHovered(pathAt(e.instanceId))
  }
  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation()
    const p = pathAt(e.instanceId)
    if (p) setSelected(p)
  }

  return (
    <group>
      <instancedMesh
        key={`trunk${count}`}
        ref={trunkRef}
        args={[trunkGeo, undefined, count]}
        frustumCulled={false}
        castShadow
      >
        <meshStandardMaterial color="#5a3f28" roughness={0.9} metalness={0} />
      </instancedMesh>
      <instancedMesh
        key={`foliage${count}`}
        ref={foliageRef}
        args={[foliageGeo, undefined, count]}
        frustumCulled={false}
        castShadow
        onPointerMove={onMove}
        onPointerOut={() => setHovered(null)}
        onClick={onClick}
      >
        <meshStandardMaterial roughness={0.85} metalness={0} vertexColors={false} />
      </instancedMesh>
    </group>
  )
}
