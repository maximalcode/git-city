import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferGeometry
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SHIP_CLASS, type ShipClass } from '../layout/fleet'

/**
 * Spaceship hulls for the fleet view, merged from primitives (no drei, no
 * external models). Modelled around the origin, nose facing +X. Painted parts
 * carry constant vertex colors that multiply the per-instance color-mode
 * color: white hull takes the paint job, dark canopy/greebles stay dark.
 */

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

function merge(parts: BufferGeometry[]): BufferGeometry {
  const nonIndexed = parts.map((g) => g.toNonIndexed())
  const merged = mergeGeometries(nonIndexed)!
  for (const g of parts) g.dispose()
  for (const g of nonIndexed) g.dispose()
  return merged
}

/** Fighter (~2.6 long): fuselage, nose cone, swept wings, tail fin, canopy. */
export function fighterGeometry(): BufferGeometry {
  const fuselage = paint(new CylinderGeometry(0.16, 0.34, 1.9, 6), 1)
  fuselage.rotateZ(-Math.PI / 2)
  const nose = paint(new ConeGeometry(0.16, 0.7, 6), 1)
  nose.rotateZ(-Math.PI / 2)
  nose.translate(1.25, 0, 0)
  const wings = paint(new BoxGeometry(0.9, 0.06, 2.4), 1)
  wings.translate(-0.25, 0, 0)
  const fin = paint(new BoxGeometry(0.5, 0.6, 0.06), 1)
  fin.translate(-0.8, 0.32, 0)
  const canopy = paint(new SphereGeometry(0.16, 8, 6), 0.1)
  canopy.translate(0.45, 0.18, 0)
  return merge([fuselage, nose, wings, fin, canopy])
}

/** Freighter (~3.6): boxy hull, cab, cargo containers, twin nacelles. */
export function freighterGeometry(): BufferGeometry {
  const hull = paint(new BoxGeometry(3.2, 0.8, 1.2), 1)
  const cab = paint(new BoxGeometry(0.7, 1.0, 1.3), 1)
  cab.translate(1.5, 0.2, 0)
  const windshield = paint(new BoxGeometry(0.1, 0.4, 1.1), 0.1)
  windshield.translate(1.85, 0.35, 0)
  const parts = [hull, cab, windshield]
  for (const cx of [-0.2, -1.4]) {
    const box = paint(new BoxGeometry(1.2, 0.6, 1.05), 0.35)
    box.translate(cx, 0.7, 0)
    parts.push(box)
  }
  for (const sz of [-0.75, 0.75]) {
    const nacelle = paint(new CylinderGeometry(0.2, 0.2, 1.4, 8), 0.35)
    nacelle.rotateZ(-Math.PI / 2)
    nacelle.translate(-1.2, -0.1, sz)
    parts.push(nacelle)
  }
  return merge(parts)
}

/** Capital ship (~6.5): long hull, dorsal ridge, bridge, prow, nacelles. */
export function capitalGeometry(): BufferGeometry {
  const hull = paint(new BoxGeometry(6, 1.1, 1.9), 1)
  const ridge = paint(new BoxGeometry(3.4, 0.5, 0.9), 1)
  ridge.translate(-0.4, 0.8, 0)
  const bridge = paint(new BoxGeometry(0.6, 0.9, 0.6), 0.1)
  bridge.translate(-1.8, 1.3, 0)
  const prow = paint(new ConeGeometry(0.95, 1.6, 4), 1)
  prow.rotateZ(-Math.PI / 2)
  prow.rotateX(Math.PI / 4)
  prow.translate(3.7, 0, 0)
  const parts = [hull, ridge, bridge, prow]
  for (const sz of [-0.8, 0.8]) {
    const nacelle = paint(new CylinderGeometry(0.3, 0.3, 3, 8), 0.35)
    nacelle.rotateZ(-Math.PI / 2)
    nacelle.translate(-1, -0.75, sz)
    parts.push(nacelle)
  }
  return merge(parts)
}

/** Engine-glow anchor points (tail positions) per ship class, model space. */
export function engineAnchors(cls: ShipClass): [number, number, number][] {
  switch (cls) {
    case SHIP_CLASS.fighter:
      return [[-1.0, 0, 0]]
    case SHIP_CLASS.freighter:
      return [
        [-1.95, -0.1, -0.75],
        [-1.95, -0.1, 0.75]
      ]
    case SHIP_CLASS.capital:
      return [
        [-2.55, -0.75, -0.8],
        [-2.55, -0.75, 0.8]
      ]
  }
  return []
}

const geometryCache = new Map<ShipClass, BufferGeometry>()

/** Cached per class; shared geometry — consumers must never dispose it. */
export function shipGeometryFor(cls: ShipClass): BufferGeometry {
  const cached = geometryCache.get(cls)
  if (cached) return cached
  const built =
    cls === SHIP_CLASS.capital
      ? capitalGeometry()
      : cls === SHIP_CLASS.freighter
        ? freighterGeometry()
        : fighterGeometry()
  geometryCache.set(cls, built)
  return built
}
