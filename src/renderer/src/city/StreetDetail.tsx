import { useLayoutEffect, useMemo, useRef } from 'react'
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
import { geometryFor, type AgentKind } from './trafficShapes'
import { buildStreetDetail } from './streetFurniture'
import { useStore } from '../store'
import { getTheme } from './themes'

/**
 * Static street furniture from the deterministic streetDetail data: parked
 * cars hugging the curb, stop lines at junction approaches, manhole covers,
 * and traffic lights (with an emissive red/green head the bloom pass lifts
 * at night). Everything instanced; nothing animates.
 */

const dummy = new Object3D()
const colorScratch = new Color()

/** body styles found at the curb (no buses — they don't park on the street) */
const PARKED_KINDS: AgentKind[] = ['car', 'wagon', 'van']

/** parked cars are duller than moving traffic — sun-faded curb colors */
const PARKED_COLORS = [
  '#8f9aa6',
  '#6e7d8a',
  '#9a8f83',
  '#7a8a99',
  '#8d8d94',
  '#5d6b78',
  '#a39a8b',
  '#77808d'
]

let poleGeo: BufferGeometry | null = null
function trafficPoleGeometry(): BufferGeometry {
  if (poleGeo) return poleGeo
  const pole = new CylinderGeometry(0.045, 0.06, 2.3, 6)
  pole.translate(0, 1.15, 0)
  const head = new BoxGeometry(0.16, 0.44, 0.14)
  head.translate(0.02, 2.32, 0)
  poleGeo = mergeGeometries([pole.toNonIndexed(), head.toNonIndexed()])!
  pole.dispose()
  head.dispose()
  return poleGeo
}

export default function StreetDetail({ model }: { model: CityModel }): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))
  const agentScale = Math.min(1, model.citySize / 140)

  const data = useMemo(() => buildStreetDetail(model.roadGraph, agentScale), [model, agentScale])

  // ground vehicles look wrong under the hovercraft theme — keep lights/manholes
  const showParked = theme.id !== 'neon'

  if (model.roadGraph.edges.length === 0) return null

  return (
    <group>
      {showParked &&
        PARKED_KINDS.map((kind, ki) => {
          // deterministic body-style mix so a parked row isn't a clone army
          const slice = data.parked.filter((p) => p.tint % PARKED_KINDS.length === ki)
          return slice.length > 0 ? (
            <ParkedCars key={kind} kind={kind} data={slice} scale={agentScale} />
          ) : null
        })}
      {data.stopLines.length > 0 && <StopLines data={data.stopLines} color={theme.road.marking} />}
      {data.manholes.length > 0 && <Manholes data={data.manholes} scale={agentScale} />}
      {data.lights.length > 0 && <TrafficLights data={data.lights} scale={agentScale} />}
    </group>
  )
}

function ParkedCars({
  kind,
  data,
  scale
}: {
  kind: AgentKind
  data: ReturnType<typeof buildStreetDetail>['parked']
  scale: number
}): React.JSX.Element {
  const meshRef = useRef<InstancedMesh>(null!)
  const geometry = geometryFor(kind)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < data.length; i++) {
      const p = data[i]
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(0, -p.angle, 0)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, colorScratch.set(PARKED_COLORS[p.tint % PARKED_COLORS.length]))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [data, scale])

  return (
    <instancedMesh
      key={data.length}
      ref={meshRef}
      args={[geometry, undefined, data.length]}
      castShadow
      frustumCulled={false}
    >
      <meshStandardMaterial roughness={0.65} metalness={0.15} vertexColors />
    </instancedMesh>
  )
}

function StopLines({
  data,
  color
}: {
  data: ReturnType<typeof buildStreetDetail>['stopLines']
  color: string
}): React.JSX.Element {
  const meshRef = useRef<InstancedMesh>(null!)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < data.length; i++) {
      const s = data[i]
      dummy.position.set(s.x, s.y, s.z)
      dummy.rotation.set(0, s.angle, 0)
      // unit quad: x = line thickness (along travel), z = line length
      dummy.scale.set(0.24, 1, s.length)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [data])

  return (
    <instancedMesh
      key={data.length}
      ref={meshRef}
      args={[undefined, undefined, data.length]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 0.004, 1]} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0} />
    </instancedMesh>
  )
}

function Manholes({
  data,
  scale
}: {
  data: ReturnType<typeof buildStreetDetail>['manholes']
  scale: number
}): React.JSX.Element {
  const meshRef = useRef<InstancedMesh>(null!)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < data.length; i++) {
      const m = data[i]
      dummy.position.set(m.x, m.y + 0.006, m.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(Math.max(0.55, scale))
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [data, scale])

  return (
    <instancedMesh
      key={data.length}
      ref={meshRef}
      args={[undefined, undefined, data.length]}
      frustumCulled={false}
    >
      <cylinderGeometry args={[0.17, 0.17, 0.008, 12]} />
      <meshStandardMaterial color="#1c1f26" roughness={0.55} metalness={0.6} />
    </instancedMesh>
  )
}

function TrafficLights({
  data,
  scale
}: {
  data: ReturnType<typeof buildStreetDetail>['lights']
  scale: number
}): React.JSX.Element {
  const poleRef = useRef<InstancedMesh>(null!)
  const lampRef = useRef<InstancedMesh>(null!)
  const s = Math.max(0.6, scale)

  useLayoutEffect(() => {
    const pole = poleRef.current
    const lamp = lampRef.current
    if (!pole || !lamp) return
    for (let i = 0; i < data.length; i++) {
      const l = data[i]
      dummy.position.set(l.x, l.y, l.z)
      dummy.rotation.set(0, l.angle, 0)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      pole.setMatrixAt(i, dummy.matrix)
      // lamp dot sits on the head's junction-facing side
      const hx = l.x + Math.cos(l.angle) * 0.1 * s
      const hz = l.z - Math.sin(l.angle) * 0.1 * s
      const hy = l.y + (l.phase === 1 ? 2.2 : 2.44) * s
      dummy.position.set(hx, hy, hz)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      lamp.setMatrixAt(i, dummy.matrix)
      lamp.setColorAt(i, colorScratch.set(l.phase === 1 ? '#37e067' : '#ff4545'))
    }
    pole.instanceMatrix.needsUpdate = true
    lamp.instanceMatrix.needsUpdate = true
    if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true
  }, [data, s])

  return (
    <group>
      <instancedMesh
        key={`p${data.length}`}
        ref={poleRef}
        args={[trafficPoleGeometry(), undefined, data.length]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial color="#2a2e36" roughness={0.6} metalness={0.5} />
      </instancedMesh>
      <instancedMesh
        key={`l${data.length}`}
        ref={lampRef}
        args={[undefined, undefined, data.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.055, 8, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
