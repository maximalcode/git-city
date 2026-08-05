import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedMesh, Object3D } from 'three'
import type { FarmModel } from '../layout/farm'
import { useStore } from '../store'
import { getTheme } from './themes'
import {
  WIND_PUMP_HUB_Y,
  barnGeometry,
  farmGlowGeometry,
  fenceGeometry,
  siloGeometry,
  windPumpGeometry,
  windPumpRotorGeometry
} from './farmShapes'

const dummy = new Object3D()
// YXZ: yaw about Y first, then X — which by then is the rotor's own axle
dummy.rotation.order = 'YXZ'

/**
 * The built farm: a barn and silo on every top-level parcel, wind pumps on the
 * larger ones, and post-and-rail fences along the parcel edges.
 *
 * Fences follow the treemap's district rectangles rather than its road graph —
 * a farm's boundaries are its field edges, and the roads become the tracks
 * between them.
 */
export default function Farmstead({ model }: { model: FarmModel }): React.JSX.Element {
  return (
    <group>
      <Steads model={model} />
      <Fences model={model} />
    </group>
  )
}

function Steads({ model }: { model: FarmModel }): React.JSX.Element | null {
  const barnRef = useRef<InstancedMesh>(null!)
  const siloRef = useRef<InstancedMesh>(null!)
  const pumpRef = useRef<InstancedMesh>(null!)
  const rotorRef = useRef<InstancedMesh>(null!)
  const glowRef = useRef<InstancedMesh>(null!)

  const lights = getTheme(useStore((s) => s.themeId)).farmLights
  const reduceMotion = useStore((s) => s.reduceMotion)

  const barnGeo = useMemo(() => barnGeometry(), [])
  const siloGeo = useMemo(() => siloGeometry(), [])
  const pumpGeo = useMemo(() => windPumpGeometry(), [])
  const rotorGeo = useMemo(() => windPumpRotorGeometry(), [])
  // Built only when a theme wants it, so Daylight pays nothing for geometry it
  // would render as five dull grey boxes on every farmstead.
  const glowGeo = useMemo(() => (lights.enabled ? farmGlowGeometry() : null), [lights.enabled])
  useLayoutEffect(
    () => () => {
      barnGeo.dispose()
      siloGeo.dispose()
      pumpGeo.dispose()
      rotorGeo.dispose()
    },
    [barnGeo, siloGeo, pumpGeo, rotorGeo]
  )
  useLayoutEffect(() => () => glowGeo?.dispose(), [glowGeo])

  // wind pumps only on parcels with room for one, so small holdings stay tidy
  const pumps = useMemo(
    () => model.steads.filter((s) => Math.min(s.rect.w, s.rect.h) > 26),
    [model]
  )

  useLayoutEffect(() => {
    const barns = barnRef.current
    const silos = siloRef.current
    if (!barns || !silos) return
    // the glow shares the barn's placement exactly — its geometry is authored
    // in the barn's own local space, so one matrix drives both
    const glow = glowRef.current
    model.steads.forEach((s, i) => {
      // tuck the buildings into a corner of the parcel, off the crop
      const bx = s.rect.x + Math.min(5.5, s.rect.w * 0.16)
      const bz = s.rect.y + Math.min(4.0, s.rect.h * 0.14)
      const face = (i % 4) * (Math.PI / 2)
      dummy.position.set(bx, 0, bz)
      dummy.rotation.set(0, face, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      barns.setMatrixAt(i, dummy.matrix)
      glow?.setMatrixAt(i, dummy.matrix)

      dummy.position.set(bx + Math.cos(face + 0.9) * 5.2, 0, bz + Math.sin(face + 0.9) * 5.2)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      silos.setMatrixAt(i, dummy.matrix)
    })
    barns.instanceMatrix.needsUpdate = true
    silos.instanceMatrix.needsUpdate = true
    if (glow) glow.instanceMatrix.needsUpdate = true
  }, [model, glowGeo])

  useLayoutEffect(() => {
    const mesh = pumpRef.current
    const rotors = rotorRef.current
    if (!mesh) return
    pumps.forEach((s, i) => {
      dummy.position.set(s.rect.x + s.rect.w - 4.5, 0, s.rect.y + s.rect.h - 4.5)
      dummy.rotation.set(0, i * 1.1, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // the rotor hangs on the same tower: same spot, same yaw, axle height up
      dummy.position.y = WIND_PUMP_HUB_Y
      dummy.updateMatrix()
      rotors?.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (rotors) rotors.instanceMatrix.needsUpdate = true
  }, [pumps])

  // The one thing on a farmstead that visibly moves. Reduce motion parks the
  // blades at whatever angle they were milled to — same contract as Traffic —
  // and the placement effect above means they exist even if this never runs.
  useFrame((state) => {
    const rotors = rotorRef.current
    if (!rotors || reduceMotion || pumps.length === 0) return
    const t = state.clock.elapsedTime
    pumps.forEach((s, i) => {
      dummy.position.set(
        s.rect.x + s.rect.w - 4.5,
        WIND_PUMP_HUB_Y,
        s.rect.y + s.rect.h - 4.5
      )
      // each pump finds its own wind: same direction, slightly different speed
      dummy.rotation.set(t * (0.9 + ((i * 7) % 5) * 0.22), i * 1.1, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      rotors.setMatrixAt(i, dummy.matrix)
    })
    rotors.instanceMatrix.needsUpdate = true
  })

  if (model.steads.length === 0) return null
  return (
    <group>
      <instancedMesh
        ref={barnRef}
        args={[barnGeo, undefined, model.steads.length]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial vertexColors roughness={0.85} />
      </instancedMesh>
      <instancedMesh
        ref={siloRef}
        args={[siloGeo, undefined, model.steads.length]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial vertexColors roughness={0.7} metalness={0.2} />
      </instancedMesh>
      {pumps.length > 0 && (
        <instancedMesh ref={pumpRef} args={[pumpGeo, undefined, pumps.length]} castShadow>
          <meshStandardMaterial vertexColors roughness={0.8} />
        </instancedMesh>
      )}
      {pumps.length > 0 && (
        <instancedMesh ref={rotorRef} args={[rotorGeo, undefined, pumps.length]} castShadow>
          <meshStandardMaterial vertexColors roughness={0.8} />
        </instancedMesh>
      )}
      {glowGeo && (
        // Unlit and emissive, like the city's window grids: these are light
        // sources in the composition, not surfaces to be lit. No shadows —
        // a lamp head that casts one reads as a floating box.
        <instancedMesh
          key={lights.color}
          ref={glowRef}
          args={[glowGeo, undefined, model.steads.length]}
        >
          <meshBasicMaterial color={lights.color} toneMapped={false} />
        </instancedMesh>
      )}
    </group>
  )
}

/** Post-and-rail runs along every parcel edge, one instance per fence section. */
function Fences({ model }: { model: FarmModel }): React.JSX.Element | null {
  const ref = useRef<InstancedMesh>(null!)
  const geo = useMemo(() => fenceGeometry(), [])
  useLayoutEffect(() => () => geo.dispose(), [geo])

  const sections = useMemo(() => {
    const SECTION = 2 // matches the rail length in fenceGeometry
    const out: { x: number; z: number; rot: number }[] = []
    // only the top parcels get fenced; fencing every nested folder is noise
    for (const d of model.layout.districts.filter((d) => d.depth === 1)) {
      const { x, y, w, h } = d.rect
      const along = (len: number, place: (t: number) => { x: number; z: number }, rot: number) => {
        const steps = Math.max(1, Math.round(len / SECTION))
        for (let i = 0; i < steps; i++) {
          const p = place((i * SECTION) / len)
          out.push({ ...p, rot })
        }
      }
      along(w, (t) => ({ x: x + t * w, z: y }), 0)
      along(w, (t) => ({ x: x + t * w, z: y + h }), 0)
      along(h, (t) => ({ x, z: y + t * h }), Math.PI / 2)
      along(h, (t) => ({ x: x + w, z: y + t * h }), Math.PI / 2)
    }
    // a huge repo would otherwise fence itself into a million draws
    return out.slice(0, 6000)
  }, [model])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    sections.forEach((s, i) => {
      dummy.position.set(s.x, 0, s.z)
      dummy.rotation.set(0, s.rot, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [sections])

  if (sections.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geo, undefined, sections.length]} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} />
    </instancedMesh>
  )
}
