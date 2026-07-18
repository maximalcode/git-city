import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  OctahedronGeometry,
  SphereGeometry,
  type BufferGeometry
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Tiny agents for city traffic, built by merging primitive geometries — no
 * external models, no drei. Each is modelled around the origin sitting on the
 * ground (y=0 at its base) and facing +X (direction of travel).
 *
 * Painted parts carry a constant vertex color that MULTIPLIES the per-instance
 * palette color (materials use vertexColors): white parts take the paint job,
 * dark parts (glass, tires) stay dark whatever the instance color is.
 */
export type AgentKind = 'car' | 'bike' | 'futuristic'

/** Write a constant `color` attribute over the whole geometry. */
function paint(geo: BufferGeometry, r: number, g = r, b = r): BufferGeometry {
  const count = geo.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  return geo
}

/**
 * Merge primitives after stripping indices. three's primitives disagree on
 * indexing (OctahedronGeometry is non-indexed; Box/Cylinder/Cone are indexed),
 * and mergeGeometries refuses a mixed set — normalising to non-indexed makes
 * every combination compatible.
 */
function merge(parts: BufferGeometry[]): BufferGeometry {
  const nonIndexed = parts.map((g) => g.toNonIndexed())
  const merged = mergeGeometries(nonIndexed)!
  // the merge copies vertex data — free the intermediates
  for (const g of parts) g.dispose()
  for (const g of nonIndexed) g.dispose()
  return merged
}

/** Car: chassis + dark greenhouse + roof cap + four wheels, ~2.4 long. */
export function carGeometry(): BufferGeometry {
  const chassis = paint(new BoxGeometry(2.4, 0.34, 1.0), 1)
  chassis.translate(0, 0.42, 0)
  const glass = paint(new BoxGeometry(1.29, 0.3, 0.96), 0.1)
  glass.translate(-0.12, 0.72, 0)
  const roof = paint(new BoxGeometry(1.15, 0.1, 0.86), 1)
  roof.translate(-0.12, 0.92, 0)
  const parts = [chassis, glass, roof]
  for (const sx of [-0.78, 0.78]) {
    for (const sz of [-0.55, 0.55]) {
      const wheel = paint(new CylinderGeometry(0.26, 0.26, 0.16, 12), 0.12)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(sx, 0.26, sz)
      parts.push(wheel)
    }
  }
  return merge(parts)
}

/** Bicycle: two dark wheels, painted frame, neutral rider (torso + head). */
export function bikeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const sx of [-0.55, 0.55]) {
    const wheel = paint(new CylinderGeometry(0.32, 0.32, 0.1, 10), 0.12)
    wheel.rotateX(Math.PI / 2)
    wheel.translate(sx, 0.32, 0)
    parts.push(wheel)
  }
  const frame = paint(new BoxGeometry(1.3, 0.1, 0.1), 1)
  frame.translate(0, 0.62, 0)
  const torso = paint(new CylinderGeometry(0.16, 0.2, 0.5, 8), 0.55)
  torso.translate(-0.1, 0.95, 0)
  const head = paint(new SphereGeometry(0.16, 8, 6), 0.55)
  head.translate(-0.1, 1.34, 0)
  parts.push(frame, torso, head)
  return merge(parts)
}

/** Futuristic: a floating diamond with a small fin — spins as it hovers. */
export function futuristicGeometry(): BufferGeometry {
  const core = new OctahedronGeometry(0.7, 0)
  const fin = new ConeGeometry(0.3, 0.8, 4)
  fin.rotateZ(Math.PI / 2)
  fin.translate(-0.7, 0, 0)
  return merge([core, fin])
}

/**
 * Cached per kind: agent layers remount on theme switch, and without a cache
 * each remount would build (and leak) a fresh merged geometry. Cached
 * geometries are shared — consumers must never dispose them.
 */
const geometryCache = new Map<AgentKind, BufferGeometry>()

export function geometryFor(kind: AgentKind): BufferGeometry {
  const cached = geometryCache.get(kind)
  if (cached) return cached
  const built = buildGeometry(kind)
  geometryCache.set(kind, built)
  return built
}

function buildGeometry(kind: AgentKind): BufferGeometry {
  switch (kind) {
    case 'car':
      return carGeometry()
    case 'bike':
      return bikeGeometry()
    case 'futuristic':
      return futuristicGeometry()
  }
}
