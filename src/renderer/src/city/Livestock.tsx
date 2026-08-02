import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedMesh, Object3D } from 'three'
import type { FarmModel } from '../layout/farm'
import { useStore } from '../store'
import { ANIMAL_KINDS, ANIMAL_SPEED, animalGeometry, type AnimalKind } from './farmShapes'

const dummy = new Object3D()

/**
 * The herds. Animals graze inside a parcel, wandering to a new spot, pausing to
 * eat, then moving on — the loop that makes a still farm look inhabited.
 *
 * Each kind is one instanced mesh with baked vertex colours, so the whole herd
 * costs a single draw call. Animals are scattered over the top-level parcels
 * rather than the fields, so they wander the holding instead of standing in the
 * middle of the crop.
 */

interface Animal {
  /** grazing home, and the radius it wanders within */
  hx: number
  hz: number
  range: number
  x: number
  z: number
  /** where it is walking to */
  tx: number
  tz: number
  heading: number
  /** seconds left of the current pause; walks when 0 */
  rest: number
  speed: number
}

/** How many of each kind. Bigger holdings carry more stock, up to a cap. */
function herdSize(kind: AnimalKind, parcels: number): number {
  const per: Record<AnimalKind, number> = { cow: 5, sheep: 9, pig: 3, chicken: 7 }
  return Math.max(kind === 'pig' ? 3 : 6, Math.min(140, parcels * per[kind]))
}

function rand(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export default function Livestock({ model }: { model: FarmModel }): React.JSX.Element {
  return (
    <group>
      {ANIMAL_KINDS.map((kind) => (
        <Herd key={kind} kind={kind} model={model} />
      ))}
    </group>
  )
}

function Herd({ kind, model }: { kind: AnimalKind; model: FarmModel }): React.JSX.Element | null {
  const ref = useRef<InstancedMesh>(null!)
  const reduceMotion = useStore((s) => s.reduceMotion)
  // passed as a prop (not JSX-created), so R3F won't dispose it for us
  const geo = useMemo(() => animalGeometry(kind), [kind])
  useLayoutEffect(() => () => geo.dispose(), [geo])

  const herd = useMemo(() => {
    // graze on the parcels, falling back to the whole holding for a tiny repo
    const areas =
      model.steads.length > 0
        ? model.steads.map((s) => s.rect)
        : [
            {
              x: -model.worldSize / 2,
              y: -model.worldSize / 2,
              w: model.worldSize,
              h: model.worldSize
            }
          ]
    const count = herdSize(kind, areas.length)
    const salt = ANIMAL_KINDS.indexOf(kind) + 1
    const out: Animal[] = []
    for (let i = 0; i < count; i++) {
      const a = areas[i % areas.length]
      // keep clear of the parcel edge so animals do not stand in the fence line
      const inset = 0.8
      const hx = a.x + inset + rand(i, salt) * Math.max(0.1, a.w - inset * 2)
      const hz = a.y + inset + rand(i, salt + 40) * Math.max(0.1, a.h - inset * 2)
      const range = Math.min(6, Math.max(1.5, Math.min(a.w, a.h) * 0.28))
      out.push({
        hx,
        hz,
        range,
        x: hx,
        z: hz,
        tx: hx,
        tz: hz,
        heading: rand(i, salt + 80) * Math.PI * 2,
        rest: rand(i, salt + 120) * 6,
        speed: ANIMAL_SPEED[kind] * (0.75 + rand(i, salt + 160) * 0.5)
      })
    }
    return out
  }, [kind, model])

  useFrame((_state, dt) => {
    const mesh = ref.current
    if (!mesh || herd.length === 0) return
    // grazing, but standing still — see the note in Traffic
    const step = reduceMotion ? 0 : Math.min(dt, 0.05)

    for (let i = 0; i < herd.length; i++) {
      const a = herd[i]
      if (a.rest > 0) {
        a.rest -= step
      } else {
        const dx = a.tx - a.x
        const dz = a.tz - a.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.12) {
          // arrived: graze a while, then pick a new spot within range of home
          a.rest = 2 + rand(i, a.x * 7 + 3) * 7
          const ang = rand(i, a.z * 11 + 5) * Math.PI * 2
          const r = rand(i, a.x * 13 + 7) * a.range
          a.tx = a.hx + Math.cos(ang) * r
          a.tz = a.hz + Math.sin(ang) * r
        } else {
          a.x += (dx / dist) * a.speed * step
          a.z += (dz / dist) * a.speed * step
          // turn toward travel; atan2(dx, dz) because the models face +X
          const want = Math.atan2(dz, dx)
          let turn = want - a.heading
          while (turn > Math.PI) turn -= Math.PI * 2
          while (turn < -Math.PI) turn += Math.PI * 2
          a.heading += turn * Math.min(1, 6 * step)
        }
      }
      dummy.position.set(a.x, 0, a.z)
      dummy.rotation.set(0, -a.heading, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  if (herd.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[geo, undefined, herd.length]} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.9} />
    </instancedMesh>
  )
}
