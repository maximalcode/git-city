import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  BufferGeometry,
  ConeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry
} from 'three'
import type { RehearsalReviewChange } from '../../../shared/types'

type HotspotsProps = {
  anchors?: [number, number, number][]
  color?: string
  markers?: { position: [number, number, number]; change: RehearsalReviewChange; path?: string }[]
  onSelectPath?: (path: string) => void
}

/**
 * Pulsing beacons over the repo's activity hotspots (the files churning most
 * this week). One per anchor: a downward marker cone that bobs above the
 * rooftop/canopy, plus an expanding halo ring that fades. Review markers are
 * batched by shape/color so a large inventory does not create one mesh/material
 * pair per file.
 */
export default function Hotspots({
  anchors,
  color = '#ffb347',
  markers,
  onSelectPath
}: HotspotsProps): React.JSX.Element | null {
  if ((anchors?.length ?? 0) === 0 && (!markers || markers.length === 0)) return null
  const markerGroups = new Map<RehearsalReviewChange, NonNullable<HotspotsProps['markers']>>()
  markers?.forEach((marker) => {
    const group = markerGroups.get(marker.change) ?? []
    group.push(marker)
    markerGroups.set(marker.change, group)
  })
  return (
    <group>
      {anchors?.map((a, i) => (
        <Beacon key={i} position={a} phase={i * 0.7} color={color} />
      ))}
      {Array.from(markerGroups).map(([change, group]) => (
        <ReviewBeaconBatch
          key={change}
          markers={group}
          change={change}
          onSelectPath={onSelectPath}
        />
      ))}
    </group>
  )
}

function reviewColor(change: RehearsalReviewChange): string {
  if (change === 'added') return '#66d99a'
  if (change === 'deleted') return '#ff7070'
  if (change === 'renamed') return '#c995ff'
  if (change === 'typechange') return '#ffc266'
  return '#6ec8ff'
}

function reviewGeometry(change: RehearsalReviewChange): BufferGeometry {
  if (change === 'deleted') return new SphereGeometry(0.72, 8, 4)
  if (change === 'renamed') return new OctahedronGeometry(0.8)
  if (change === 'typechange') return new TorusGeometry(0.52, 0.18, 8, 12)
  return new ConeGeometry(change === 'added' ? 0.85 : 0.7, 1.6, 5)
}

function ReviewBeaconBatch({
  markers,
  change,
  onSelectPath
}: {
  markers: NonNullable<HotspotsProps['markers']>
  change: RehearsalReviewChange
  onSelectPath?: (path: string) => void
}): React.JSX.Element {
  const beacon = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => reviewGeometry(change), [change])
  const ringGeometry = useMemo(() => new RingGeometry(0.75, 1.05, 24), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: reviewColor(change),
        toneMapped: false,
        transparent: true,
        opacity: 0.9
      }),
    [change]
  )
  const ringMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: reviewColor(change),
        toneMapped: false,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      }),
    [change]
  )
  const dummy = useMemo(() => new Object3D(), [])
  const ringDummy = useMemo(() => new Object3D(), [])

  useEffect(
    () => () => {
      geometry.dispose()
      ringGeometry.dispose()
      material.dispose()
      ringMaterial.dispose()
    },
    [geometry, ringGeometry, material, ringMaterial]
  )

  useFrame((state) => {
    const beaconMesh = beacon.current
    const ringMesh = ring.current
    if (!beaconMesh || !ringMesh) return
    markers.forEach((marker, index) => {
      const t = state.clock.elapsedTime + index * 0.7
      const [x, y, z] = marker.position
      dummy.position.set(x, y + 2.2 + Math.sin(t * 2) * 0.5, z)
      dummy.rotation.set(Math.PI, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      beaconMesh.setMatrixAt(index, dummy.matrix)

      const p = (t % 1.6) / 1.6
      ringDummy.position.set(x, y + 0.4, z)
      ringDummy.rotation.set(-Math.PI / 2, 0, 0)
      ringDummy.scale.setScalar(0.4 + p * 2.4)
      ringDummy.updateMatrix()
      ringMesh.setMatrixAt(index, ringDummy.matrix)
    })
    beaconMesh.instanceMatrix.needsUpdate = true
    ringMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={beacon}
        args={[geometry, material, markers.length]}
        frustumCulled={false}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          const path = event.instanceId === undefined ? undefined : markers[event.instanceId]?.path
          if (path) onSelectPath?.(path)
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation()
          const path = event.instanceId === undefined ? undefined : markers[event.instanceId]?.path
          if (path) {
            onSelectPath?.(path)
          }
        }}
      />
      <instancedMesh
        ref={ring}
        args={[ringGeometry, ringMaterial, markers.length]}
        frustumCulled={false}
      />
    </>
  )
}

function Beacon({
  position,
  phase,
  color = '#ffb347'
}: {
  position: [number, number, number]
  phase: number
  color?: string
}): React.JSX.Element {
  const cone = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
  const ringMat = useRef<MeshBasicMaterial>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase
    if (cone.current) cone.current.position.y = 2.2 + Math.sin(t * 2) * 0.5
    // ring expands + fades on a ~1.6s loop
    const p = (t % 1.6) / 1.6
    if (ring.current) {
      const s = 0.4 + p * 2.4
      ring.current.scale.set(s, s, s)
    }
    if (ringMat.current) ringMat.current.opacity = (1 - p) * 0.5
  })

  const [x, y, z] = position
  return (
    <group position={[x, y, z]}>
      {/* bobbing marker cone (apex down) */}
      <group ref={cone} position={[0, 2.2, 0]}>
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.7, 1.6, 5]} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} />
        </mesh>
      </group>
      {/* expanding halo ring at the rooftop */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
        <ringGeometry args={[0.75, 1.05, 24]} />
        <meshBasicMaterial
          ref={ringMat}
          color={color}
          toneMapped={false}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
