import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Object3D,
  type BufferGeometry
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CityModel, Targets } from './cityData'
import { useStore } from '../store'
import { getTheme } from './themes'

/**
 * Rooftop clutter — AC units, water tanks, antennas — the "silhouette noise"
 * real skylines have. Placed deterministically per building (hash of its plot),
 * only on buildings tall and wide enough, and animated to ride the same
 * height-lerp as the buildings so gear never floats above a rising tower.
 */

const dummy = new Object3D()
const colorScratch = new Color()

/** buildings shorter than this get no roof gear */
const MIN_H = 7
/** min footprint side for any clutter */
const MIN_SIDE = 1.2

type ClutterKind = 'ac' | 'tank' | 'antenna'

let acGeo: BufferGeometry | null = null
let tankGeo: BufferGeometry | null = null
let antennaGeo: BufferGeometry | null = null

/** module-cached geometries (shared; never disposed by consumers) */
function geometryFor(kind: ClutterKind): BufferGeometry {
  if (kind === 'ac') {
    if (!acGeo) {
      const body = new BoxGeometry(0.72, 0.34, 0.55)
      body.translate(0, 0.17, 0)
      const fan = new CylinderGeometry(0.19, 0.19, 0.06, 10)
      fan.translate(0, 0.37, 0)
      acGeo = mergeGeometries([body.toNonIndexed(), fan.toNonIndexed()])!
      body.dispose()
      fan.dispose()
    }
    return acGeo
  }
  if (kind === 'tank') {
    if (!tankGeo) {
      const legs = new BoxGeometry(0.5, 0.28, 0.5)
      legs.translate(0, 0.14, 0)
      const drum = new CylinderGeometry(0.34, 0.34, 0.72, 10)
      drum.translate(0, 0.64, 0)
      const cap = new ConeGeometry(0.36, 0.22, 10)
      cap.translate(0, 1.11, 0)
      tankGeo = mergeGeometries([legs.toNonIndexed(), drum.toNonIndexed(), cap.toNonIndexed()])!
      legs.dispose()
      drum.dispose()
      cap.dispose()
    }
    return tankGeo
  }
  if (!antennaGeo) {
    const mast = new CylinderGeometry(0.025, 0.045, 1.5, 5)
    mast.translate(0, 0.75, 0)
    const cross = new BoxGeometry(0.34, 0.03, 0.03)
    cross.translate(0, 1.18, 0)
    antennaGeo = mergeGeometries([mast.toNonIndexed(), cross.toNonIndexed()])!
    mast.dispose()
    cross.dispose()
  }
  return antennaGeo
}

const KIND_COLOR: Record<ClutterKind, string> = {
  ac: '#8f96a3',
  tank: '#8a7360',
  antenna: '#5d6470'
}

interface Item {
  building: number
  x: number
  z: number
  scale: number
  rot: number
  shade: number
}

function pseudo(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export default function RoofClutter({
  model,
  targets
}: {
  model: CityModel
  targets: Targets
}): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))

  // deterministic layout: which buildings get what, where on the roof
  const items = useMemo(() => {
    const out: Record<ClutterKind, Item[]> = { ac: [], tank: [], antenna: [] }
    for (let i = 0; i < model.paths.length; i++) {
      const h = targets.heights[i]
      const { rect } = model.layout.plots[i]
      const side = Math.min(rect.w, rect.h)
      if (h < MIN_H || side < MIN_SIDE) continue
      const seed = i * 7 + 3
      const s = Math.min(1, side * 0.42) // gear shrinks on narrow roofs
      const inset = 0.28 * s + 0.12
      const px = (): number =>
        rect.x + inset + pseudo(seed + out.ac.length * 13 + 1) * (rect.w - 2 * inset)
      const pz = (): number =>
        rect.y + inset + pseudo(seed + out.ac.length * 17 + 2) * (rect.h - 2 * inset)
      // every qualifying roof gets 1-2 AC units
      const nAc = 1 + (pseudo(seed) > 0.55 ? 1 : 0)
      for (let a = 0; a < nAc; a++) {
        out.ac.push({
          building: i,
          x: px(),
          z: pz(),
          scale: s * (0.8 + pseudo(seed + a) * 0.4),
          rot: Math.floor(pseudo(seed + a + 5) * 4) * (Math.PI / 2),
          shade: 0.85 + pseudo(seed + a + 9) * 0.3
        })
      }
      // big + tall roofs sometimes carry a water tank
      if (h > 12 && side > 2 && pseudo(seed + 31) > 0.55) {
        out.tank.push({
          building: i,
          x: px(),
          z: pz(),
          scale: s,
          rot: pseudo(seed + 37) * Math.PI,
          shade: 0.9 + pseudo(seed + 41) * 0.2
        })
      }
      // tall towers get an antenna
      if (h > 10 && pseudo(seed + 51) > 0.35) {
        out.antenna.push({
          building: i,
          x: px(),
          z: pz(),
          scale: s * (0.9 + pseudo(seed + 53) * 0.6),
          rot: 0,
          shade: 1
        })
      }
    }
    return out
  }, [model, targets])

  return (
    <group>
      {(Object.keys(items) as ClutterKind[]).map((kind) =>
        items[kind].length > 0 ? (
          <ClutterLayer
            key={`${kind}:${items[kind].length}`}
            kind={kind}
            items={items[kind]}
            targets={targets}
            lerpSpeed={theme.lerpSpeed}
          />
        ) : null
      )}
    </group>
  )
}

function ClutterLayer({
  kind,
  items,
  targets,
  lerpSpeed
}: {
  kind: ClutterKind
  items: Item[]
  targets: Targets
  lerpSpeed: number
}): React.JSX.Element {
  const meshRef = useRef<InstancedMesh>(null!)
  const geometry = geometryFor(kind)
  const base = useMemo(() => new Color(KIND_COLOR[kind]), [kind])

  // mirror the buildings' height lerp so gear rides the roof up
  const anim = useMemo(() => ({ heights: new Float32Array(items.length), settled: false }), [items])
  useEffect(() => {
    anim.settled = false
  }, [targets, anim])

  useFrame((_, dt) => {
    if (anim.settled) return
    const mesh = meshRef.current
    if (!mesh) return
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * lerpSpeed)
    let maxDelta = 0
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const th = targets.heights[it.building]
      const ch = anim.heights[i]
      const nh = ch + (th - ch) * k
      anim.heights[i] = nh
      const d = Math.abs(th - nh)
      if (d > maxDelta) maxDelta = d
      dummy.position.set(it.x, nh, it.z)
      dummy.scale.setScalar(it.scale)
      dummy.rotation.set(0, it.rot, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (maxDelta < 0.002) anim.settled = true
  })

  // per-instance shade variation, set once
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < items.length; i++) {
      mesh.setColorAt(i, colorScratch.copy(base).multiplyScalar(items[i].shade))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [items, base])

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, items.length]}
      geometry={geometry}
      castShadow
      frustumCulled={false}
    >
      <meshStandardMaterial roughness={0.75} metalness={0.35} />
    </instancedMesh>
  )
}
