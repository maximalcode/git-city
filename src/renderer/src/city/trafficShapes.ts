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
export type AgentKind = 'car' | 'wagon' | 'van' | 'bus' | 'bike' | 'futuristic'

/** the four road-vehicle body styles, in the order Traffic mixes them */
export const CAR_KINDS: AgentKind[] = ['car', 'wagon', 'van', 'bus']

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

/**
 * Body spec for a road vehicle, in world units. Real proportions: a car is
 * ~4.5 m × 1.8 m, and one world unit here is ~2.5 m, so a car body is ~1.9
 * long and ~0.74 wide — narrow enough to leave a driving lane free beside a
 * parked row. `cabFrac` is where the greenhouse sits along the body (0 = rear,
 * 1 = front); `roofDrop` insets the roof for a sloped-ish silhouette.
 */
interface BodySpec {
  length: number
  width: number
  /** height of the chassis box top above the ground */
  bodyH: number
  cabLen: number
  cabH: number
  cabAt: number
  wheelR: number
  axles: number[]
}

const BODIES: Record<'car' | 'wagon' | 'van' | 'bus', BodySpec> = {
  car: { length: 1.9, width: 0.74, bodyH: 0.34, cabLen: 0.82, cabH: 0.26, cabAt: -0.05, wheelR: 0.19, axles: [-0.6, 0.6] },
  wagon: { length: 2.05, width: 0.76, bodyH: 0.36, cabLen: 1.15, cabH: 0.3, cabAt: -0.15, wheelR: 0.2, axles: [-0.66, 0.66] },
  van: { length: 2.2, width: 0.82, bodyH: 0.44, cabLen: 1.5, cabH: 0.46, cabAt: -0.2, wheelR: 0.21, axles: [-0.72, 0.72] },
  bus: { length: 3.4, width: 0.9, bodyH: 0.52, cabLen: 2.9, cabH: 0.62, cabAt: -0.05, wheelR: 0.24, axles: [-1.2, 0.2, 1.15] }
}

/**
 * A road vehicle: chassis, greenhouse with a dark glass band, roof, wheels,
 * and emissive-white head/tail light blocks. Modelled facing +X with its base
 * at y=0. Lights are painted pure white so the instance color multiplies them
 * to the paint job's hue — Traffic overrides them with a dedicated glow layer.
 */
function bodyGeometry(kind: 'car' | 'wagon' | 'van' | 'bus'): BufferGeometry {
  const s = BODIES[kind]
  const hw = s.width / 2
  const hl = s.length / 2
  const floorY = s.wheelR * 0.85

  const chassis = paint(new BoxGeometry(s.length, s.bodyH, s.width), 1)
  chassis.translate(0, floorY + s.bodyH / 2, 0)
  // greenhouse: a slightly inset painted shell with a dark glass band inside it
  const cabY = floorY + s.bodyH
  const glass = paint(new BoxGeometry(s.cabLen, s.cabH, s.width * 0.97), 0.08)
  glass.translate(s.cabAt, cabY + s.cabH / 2, 0)
  const roof = paint(new BoxGeometry(s.cabLen * 0.94, 0.07, s.width * 0.9), 1)
  roof.translate(s.cabAt, cabY + s.cabH + 0.03, 0)
  const parts: BufferGeometry[] = [chassis, glass, roof]

  for (const ax of s.axles) {
    for (const sz of [-hw + 0.03, hw - 0.03]) {
      const wheel = paint(new CylinderGeometry(s.wheelR, s.wheelR, 0.12, 10), 0.1)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(ax, s.wheelR, sz)
      parts.push(wheel)
    }
  }

  // head + tail light blocks, flush with the body ends
  const lampY = floorY + s.bodyH * 0.62
  for (const [ax, w] of [
    [hl - 0.02, 0.05],
    [-hl + 0.02, 0.05]
  ] as [number, number][]) {
    for (const sz of [-hw * 0.62, hw * 0.62]) {
      const lamp = paint(new BoxGeometry(w, 0.09, 0.16), 1)
      lamp.translate(ax, lampY, sz)
      parts.push(lamp)
    }
  }

  return merge(parts)
}

export function carGeometry(): BufferGeometry {
  return bodyGeometry('car')
}

/** Bicycle: two dark wheels, painted frame, neutral rider (torso + head). */
export function bikeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const sx of [-0.4, 0.4]) {
    const wheel = paint(new CylinderGeometry(0.24, 0.24, 0.07, 10), 0.12)
    wheel.rotateX(Math.PI / 2)
    wheel.translate(sx, 0.24, 0)
    parts.push(wheel)
  }
  const frame = paint(new BoxGeometry(0.95, 0.07, 0.07), 1)
  frame.translate(0, 0.46, 0)
  const torso = paint(new CylinderGeometry(0.12, 0.15, 0.38, 8), 0.55)
  torso.translate(-0.07, 0.7, 0)
  const head = paint(new SphereGeometry(0.12, 8, 6), 0.55)
  head.translate(-0.07, 0.99, 0)
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
    case 'wagon':
    case 'van':
    case 'bus':
      return bodyGeometry(kind)
    case 'bike':
      return bikeGeometry()
    case 'futuristic':
      return futuristicGeometry()
  }
}
