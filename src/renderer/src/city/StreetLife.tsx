import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Object3D,
  type BufferGeometry
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CityModel } from './cityData'
import { roadY } from './roadGeometry'
import { foliageGeometry, trunkGeometry } from './treeShapes'
import { createFoliageMaterial } from './foliageMaterial'
import { useStore } from '../store'
import { getTheme } from './themes'

/**
 * Street furniture that makes the city feel inhabited: lamp posts and leafy
 * trees lining the wider roads, plus a belt of greenery around the city edge.
 * Everything is placed deterministically from the road graph (no Math.random,
 * so it's stable across snapshots) and drawn as four InstancedMeshes.
 */

const dummy = new Object3D()

/** dark lamp post: tapered pole + a little cap. Head glow is a separate mesh. */
const POLE_H = 2.7
let lampGeo: BufferGeometry | null = null
function lampGeometry(): BufferGeometry {
  if (lampGeo) return lampGeo
  const pole = new CylinderGeometry(0.05, 0.08, POLE_H, 6)
  pole.translate(0, POLE_H / 2, 0)
  const cap = new BoxGeometry(0.26, 0.16, 0.26)
  cap.translate(0, POLE_H + 0.02, 0)
  lampGeo = mergeGeometries([pole.toNonIndexed(), cap.toNonIndexed()])!
  pole.dispose()
  cap.dispose()
  return lampGeo
}

const FOLIAGE_GREENS = ['#3f7d3a', '#4f9245', '#5aa653', '#356b34', '#68a94f']

interface Lamp {
  x: number
  z: number
  y: number
}
interface TreeInst {
  x: number
  z: number
  y: number
  scale: number
  tint: number
}

function pseudo(i: number): number {
  // deterministic 0..1 hash (no Math.random → identical layout every build)
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export default function StreetLife({ model }: { model: CityModel }): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))
  const reduceMotion = useStore((s) => s.reduceMotion)
  const graph = model.roadGraph
  const size = model.citySize

  const { lamps, trees } = useMemo(() => {
    const lamps: Lamp[] = []
    const trees: TreeInst[] = []
    let seq = 0

    // props along wider roads, on the sidewalk just past the curb
    for (const e of graph.edges) {
      if (e.width < 1.4 || e.length < 5) continue
      const na = graph.nodes[e.a]
      const nb = graph.nodes[e.b]
      const y = roadY(e.depth) + 0.16 // on top of the raised sidewalk
      const off = e.width / 2 - 0.12
      const along = e.axis === 'x' ? [1, 0] : [0, 1]
      const perp = e.axis === 'x' ? [0, 1] : [1, 0]
      const count = Math.min(6, Math.floor(e.length / 8))
      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1)
        const cx = na.x + (nb.x - na.x) * t
        const cz = na.z + (nb.z - na.z) * t
        for (const side of [1, -1]) {
          const px = cx + perp[0] * off * side
          const pz = cz + perp[1] * off * side
          // alternate lamp / tree along the street for a natural rhythm
          if ((k + (side === 1 ? 0 : 1)) % 2 === 0) {
            lamps.push({ x: px, z: pz, y })
          } else {
            trees.push({
              x: px,
              z: pz,
              y,
              scale: 0.7 + pseudo(seq) * 0.4,
              tint: Math.floor(pseudo(seq * 3 + 1) * FOLIAGE_GREENS.length)
            })
          }
          seq++
        }
      }
      void along
    }

    // a belt of trees around the city edge so it sits in a landscape
    const inner = size / 2 + 3
    const outer = size / 2 + Math.max(14, size * 0.16)
    const stepG = Math.max(5, size / 16)
    for (let gx = -outer; gx <= outer; gx += stepG) {
      for (let gz = -outer; gz <= outer; gz += stepG) {
        const ax = Math.abs(gx)
        const az = Math.abs(gz)
        if (ax < inner && az < inner) continue // keep the city core clear
        if (ax > outer || az > outer) continue
        const jx = gx + (pseudo(seq) - 0.5) * stepG * 0.7
        const jz = gz + (pseudo(seq * 2 + 5) - 0.5) * stepG * 0.7
        // thin them out a little so the belt isn't a perfect grid
        if (pseudo(seq * 7 + 3) < 0.35) {
          seq++
          continue
        }
        trees.push({
          x: jx,
          z: jz,
          y: -0.05,
          scale: 0.85 + pseudo(seq * 5 + 2) * 0.7,
          tint: Math.floor(pseudo(seq * 3 + 1) * FOLIAGE_GREENS.length)
        })
        seq++
      }
    }

    // keep instance counts bounded on very large repos
    return { lamps: lamps.slice(0, 500), trees: trees.slice(0, 800) }
  }, [graph, size])

  const poleRef = useRef<InstancedMesh>(null!)
  const headRef = useRef<InstancedMesh>(null!)
  const trunkRef = useRef<InstancedMesh>(null!)
  const foliageRef = useRef<InstancedMesh>(null!)

  // passed as a prop (not JSX-created), so R3F won't dispose it for us
  const { material: foliageMaterial, wind } = useMemo(() => createFoliageMaterial(), [])
  useEffect(() => () => foliageMaterial.dispose(), [foliageMaterial])
  useEffect(() => {
    // "Reduce motion" holds the canopies still
    wind.strength.value = reduceMotion ? 0 : 0.09
  }, [wind, reduceMotion])
  useFrame((state) => {
    if (!reduceMotion) wind.time.value = state.clock.elapsedTime
  })

  useLayoutEffect(() => {
    const pole = poleRef.current
    const head = headRef.current
    if (pole && head) {
      for (let i = 0; i < lamps.length; i++) {
        const l = lamps[i]
        dummy.position.set(l.x, l.y, l.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        pole.setMatrixAt(i, dummy.matrix)
        dummy.position.set(l.x, l.y + POLE_H, l.z)
        dummy.updateMatrix()
        head.setMatrixAt(i, dummy.matrix)
      }
      pole.instanceMatrix.needsUpdate = true
      head.instanceMatrix.needsUpdate = true
    }
  }, [lamps])

  useLayoutEffect(() => {
    const trunk = trunkRef.current
    const foliage = foliageRef.current
    if (!trunk || !foliage) return
    const c = new Color()
    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i]
      dummy.position.set(tr.x, tr.y, tr.z)
      dummy.rotation.set(0, pseudo(i) * Math.PI * 2, 0)
      dummy.scale.setScalar(tr.scale)
      dummy.updateMatrix()
      trunk.setMatrixAt(i, dummy.matrix)
      foliage.setMatrixAt(i, dummy.matrix)
      foliage.setColorAt(i, c.set(FOLIAGE_GREENS[tr.tint]))
    }
    trunk.instanceMatrix.needsUpdate = true
    foliage.instanceMatrix.needsUpdate = true
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true
  }, [trees])

  if (graph.edges.length === 0) return null

  const lampGlow = theme.windows.enabled ? theme.windows.color : '#ffe6b0'

  return (
    <group>
      {lamps.length > 0 && (
        <>
          <instancedMesh
            key={`pole${lamps.length}`}
            ref={poleRef}
            args={[lampGeometry(), undefined, lamps.length]}
            castShadow
          >
            <meshStandardMaterial color="#2b2f38" roughness={0.6} metalness={0.5} />
          </instancedMesh>
          <instancedMesh
            key={`head${lamps.length}`}
            ref={headRef}
            args={[undefined, undefined, lamps.length]}
            frustumCulled={false}
          >
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshBasicMaterial color={lampGlow} toneMapped={false} />
          </instancedMesh>
        </>
      )}
      {trees.length > 0 && (
        <>
          <instancedMesh
            key={`trunk${trees.length}`}
            ref={trunkRef}
            args={[trunkGeometry('tree'), undefined, trees.length]}
            castShadow
          >
            <meshStandardMaterial color="#5a3f28" roughness={0.9} metalness={0} />
          </instancedMesh>
          <instancedMesh
            key={`foliage${trees.length}`}
            ref={foliageRef}
            args={[foliageGeometry('tree'), undefined, trees.length]}
            castShadow
            material={foliageMaterial}
          />
        </>
      )}
    </group>
  )
}
