import { BoxGeometry, ConeGeometry, CylinderGeometry, OctahedronGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Tiny low-poly "agents" for city traffic, built by merging primitive
 * geometries — no external models, no drei. Each is modelled around the origin
 * sitting on the ground (y=0 at its base) and facing +X (direction of travel).
 */
export type AgentKind = 'car' | 'person' | 'bike' | 'futuristic'

/**
 * Merge primitives after stripping indices. three's primitives disagree on
 * indexing (OctahedronGeometry is non-indexed; Box/Cylinder/Cone are indexed),
 * and mergeGeometries refuses a mixed set — normalising to non-indexed makes
 * every combination compatible.
 */
function merge(parts: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!
}

/** Car: body + cabin, ~2.6 long. */
export function carGeometry(): BufferGeometry {
  const body = new BoxGeometry(2.6, 0.5, 1.1)
  body.translate(0, 0.3, 0)
  const cabin = new BoxGeometry(1.2, 0.45, 0.95)
  cabin.translate(-0.15, 0.75, 0)
  return merge([body, cabin])
}

/** Person: torso + head, ~1.4 tall, thin. */
export function personGeometry(): BufferGeometry {
  const body = new BoxGeometry(0.34, 0.85, 0.34)
  body.translate(0, 0.5, 0)
  const head = new BoxGeometry(0.38, 0.38, 0.38)
  head.translate(0, 1.12, 0)
  return merge([body, head])
}

/** Bicycle: two wheels + a frame bar + a rider stub. */
export function bikeGeometry(): BufferGeometry {
  const wheelFront = new CylinderGeometry(0.45, 0.45, 0.12, 10)
  wheelFront.rotateX(Math.PI / 2) // stand upright, rolling along X
  wheelFront.translate(0.7, 0.45, 0)
  const wheelBack = new CylinderGeometry(0.45, 0.45, 0.12, 10)
  wheelBack.rotateX(Math.PI / 2)
  wheelBack.translate(-0.7, 0.45, 0)
  const frame = new BoxGeometry(1.5, 0.12, 0.12)
  frame.translate(0, 0.7, 0)
  const rider = new BoxGeometry(0.32, 0.7, 0.32)
  rider.translate(-0.1, 1.05, 0)
  return merge([wheelFront, wheelBack, frame, rider])
}

/** Futuristic: a floating diamond with a small fin — spins as it hovers. */
export function futuristicGeometry(): BufferGeometry {
  const core = new OctahedronGeometry(0.7, 0)
  const fin = new ConeGeometry(0.3, 0.8, 4)
  fin.rotateZ(Math.PI / 2)
  fin.translate(-0.7, 0, 0)
  return merge([core, fin])
}

export function geometryFor(kind: AgentKind): BufferGeometry {
  switch (kind) {
    case 'car':
      return carGeometry()
    case 'person':
      return personGeometry()
    case 'bike':
      return bikeGeometry()
    case 'futuristic':
      return futuristicGeometry()
  }
}
