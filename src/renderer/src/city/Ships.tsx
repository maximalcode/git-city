import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import { useStore } from '../store'
import { getTheme } from './themes'
import { SHIP_CLASS, type FleetModel, type FleetTargets, type ShipClass } from '../layout/fleet'
import { engineAnchors, shipGeometryFor } from './shipShapes'

const dummy = new Object3D()
const colorScratch = new Color()

/** Below this scale a ship counts as "not there" for interactions. */
const MIN_VISIBLE = 0.05

/** engine-glow sphere radius per class (world units, pre ship-scale) */
const GLOW_SIZE: Record<ShipClass, number> = {
  [SHIP_CLASS.fighter]: 0.11,
  [SHIP_CLASS.freighter]: 0.16,
  [SHIP_CLASS.capital]: 0.24
}

/**
 * The fleet: one hull InstancedMesh + one engine-glow InstancedMesh per ship
 * class (6 draw calls total). Scale and color lerp toward the snapshot targets
 * like Buildings; on top, every ship idles with a gentle bob and yaw sway that
 * never settles — a fleet holds formation, it doesn't park.
 */
export default function Ships({
  model,
  targets
}: {
  model: FleetModel
  targets: FleetTargets
}): React.JSX.Element {
  const n = model.paths.length
  const anim = useMemo(
    () => ({
      scales: new Float32Array(n), // start at 0 → fleet warps in on load
      colors: new Float32Array(targets.colors),
      settledColors: false
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model]
  )
  useEffect(() => {
    anim.settledColors = false
  }, [targets, anim])

  const classes: ShipClass[] = [SHIP_CLASS.fighter, SHIP_CLASS.freighter, SHIP_CLASS.capital]
  return (
    <group>
      {classes.map((cls) => (
        <ClassLayer key={cls} cls={cls} model={model} targets={targets} anim={anim} />
      ))}
    </group>
  )
}

interface Anim {
  scales: Float32Array
  colors: Float32Array
  settledColors: boolean
}

function ClassLayer({
  cls,
  model,
  targets,
  anim
}: {
  cls: ShipClass
  model: FleetModel
  targets: FleetTargets
  anim: Anim
}): React.JSX.Element | null {
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)
  const theme = getTheme(useStore((s) => s.themeId))

  const geometry = useMemo(() => shipGeometryFor(cls), [cls])
  const anchors = useMemo(() => engineAnchors(cls), [cls])

  // ship indices of this class (global index into model arrays)
  const ships = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < model.classes.length; i++) if (model.classes[i] === cls) out.push(i)
    return out
  }, [model, cls])

  const hullRef = useRef<InstancedMesh>(null!)
  const glowRef = useRef<InstancedMesh>(null!)
  const count = ships.length

  useFrame((state, dt) => {
    const hull = hullRef.current
    if (!hull || count === 0) return
    const glow = glowRef.current
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * theme.lerpSpeed)
    const lerpColors = !anim.settledColors
    let maxColorDelta = 0

    for (let s = 0; s < count; s++) {
      const i = ships[s]
      // scale toward target (warp-in/out), colors toward the color mode
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
        hull.setColorAt(
          s,
          colorScratch.setRGB(anim.colors[i * 3], anim.colors[i * 3 + 1], anim.colors[i * 3 + 2])
        )
      }

      const phase = (i * 1.37) % (Math.PI * 2)
      const x = model.positions[i * 3]
      const y = model.positions[i * 3 + 1] + Math.sin(t * 0.5 + phase) * 0.7
      const z = model.positions[i * 3 + 2]
      const yaw = model.yaw[i] + Math.sin(t * 0.3 + phase) * 0.06
      // bank into the yaw sway (roll about the forward axis) + a little nose bob,
      // so the formation feels like it's flying rather than parked
      const roll = Math.cos(t * 0.3 + phase) * 0.14
      const pitch = Math.cos(t * 0.5 + phase) * 0.05
      const sc = Math.max(ns, 0.001)

      dummy.position.set(x, y, z)
      dummy.rotation.set(roll, yaw, pitch)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      hull.setMatrixAt(s, dummy.matrix)

      // engine glow: anchors rotated by yaw, scaled with the ship
      if (glow) {
        const cosY = Math.cos(yaw)
        const sinY = Math.sin(yaw)
        for (let a = 0; a < anchors.length; a++) {
          const [ax, ay, az] = anchors[a]
          const rx = ax * cosY + az * sinY
          const rz = -ax * sinY + az * cosY
          const flicker = 1 + 0.2 * Math.sin(t * 7 + phase + a)
          dummy.position.set(x + rx * sc, y + ay * sc, z + rz * sc)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.setScalar(
            Math.max(GLOW_SIZE[cls] * sc * flicker, 0.001) * (ns > MIN_VISIBLE ? 1 : 0.001)
          )
          dummy.updateMatrix()
          glow.setMatrixAt(s * anchors.length + a, dummy.matrix)
        }
      }
    }

    hull.instanceMatrix.needsUpdate = true
    if (lerpColors && hull.instanceColor) hull.instanceColor.needsUpdate = true
    if (lerpColors && maxColorDelta < 0.002) anim.settledColors = true
    if (glow) glow.instanceMatrix.needsUpdate = true
  })

  if (count === 0) return null

  const pathAt = (id: number | undefined): string | null => {
    if (id === undefined) return null
    const i = ships[id]
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
        key={`hull${count}`}
        ref={hullRef}
        args={[geometry, undefined, count]}
        frustumCulled={false}
        onPointerMove={onMove}
        onPointerOut={() => setHovered(null)}
        onClick={onClick}
      >
        <meshStandardMaterial roughness={0.45} metalness={0.35} vertexColors />
      </instancedMesh>
      <instancedMesh
        key={`glow${count}`}
        ref={glowRef}
        args={[undefined, undefined, count * anchors.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color={theme.windows.color} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
