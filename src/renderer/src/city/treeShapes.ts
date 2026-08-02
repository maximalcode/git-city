import { CylinderGeometry, PlaneGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Hand-built trees, merged from primitives (no drei, no external models). Every
 * tree is TWO geometries so trunk and canopy can carry different colours:
 *
 *  - `trunkGeometry(kind)`   a tapered bark cylinder (rendered with one brown
 *                            material, no per-instance colour).
 *  - `foliageGeometry(kind)` a cluster of overlapping spheres forming a full
 *                            canopy (rendered per-instance-coloured; fixed green
 *                            for the city's street trees).
 *
 * Modelled with the base of the trunk at the origin, growing +Y. Three size
 * classes give the skyline variety; per-instance scale adds the rest.
 */

export type TreeKind = 'bush' | 'tree' | 'ancient'
// Only 'tree' is planted now that the street trees are the sole user; the other
// two specs stay because they define the shared trunk/canopy proportions.

interface Spec {
  trunkH: number
  trunkR: number
  trunkTopR: number
  /** canopy blobs: [x, y, z, radius] in model space */
  blobs: [number, number, number, number][]
}

const SPECS: Record<TreeKind, Spec> = {
  bush: {
    trunkH: 0.35,
    trunkR: 0.11,
    trunkTopR: 0.09,
    blobs: [
      [0, 0.62, 0, 0.52],
      [0.26, 0.5, 0.12, 0.34]
    ]
  },
  tree: {
    trunkH: 1.5,
    trunkR: 0.18,
    trunkTopR: 0.13,
    blobs: [
      [0, 2.05, 0, 0.92],
      [0.5, 1.72, 0.22, 0.62],
      [-0.42, 1.82, -0.3, 0.6],
      [0.05, 2.55, -0.12, 0.55]
    ]
  },
  ancient: {
    trunkH: 2.7,
    trunkR: 0.34,
    trunkTopR: 0.24,
    blobs: [
      [0, 3.5, 0, 1.45],
      [0.95, 3.05, 0.25, 0.9],
      [-0.85, 3.2, -0.35, 0.85],
      [0.15, 4.15, -0.2, 0.8],
      [-0.2, 2.85, 0.7, 0.7]
    ]
  }
}

const trunkCache = new Map<TreeKind, BufferGeometry>()
const foliageCache = new Map<TreeKind, BufferGeometry>()

export function trunkGeometry(kind: TreeKind): BufferGeometry {
  const cached = trunkCache.get(kind)
  if (cached) return cached
  const s = SPECS[kind]
  const trunk = new CylinderGeometry(s.trunkTopR, s.trunkR, s.trunkH, 6)
  trunk.translate(0, s.trunkH / 2, 0)
  trunkCache.set(kind, trunk)
  return trunk
}

/**
 * Canopy as CROSS-PLANES rather than solid spheres — the standard game-engine
 * trick: each blob becomes a few camera-agnostic quads through its center,
 * textured with an alpha-tested leaf cluster. Reads as real foliage (light
 * passes through, silhouette is ragged) instead of a plastic ball, and costs
 * far fewer triangles than the sphere cluster it replaces.
 *
 * Quads are double-sided (the material sets side), UV-mapped 0..1 per quad.
 */
export function foliageGeometry(kind: TreeKind): BufferGeometry {
  const cached = foliageCache.get(kind)
  if (cached) return cached
  const s = SPECS[kind]
  const parts: BufferGeometry[] = []
  for (const [x, y, z, r] of s.blobs) {
    // 3 planes per blob at 60° apart — enough to look solid from any angle
    for (let p = 0; p < 3; p++) {
      const quad = new PlaneGeometry(r * 2.3, r * 2.3)
      quad.rotateY((p * Math.PI) / 3)
      quad.translate(x, y, z)
      parts.push(quad.toNonIndexed())
    }
    // one horizontal plane keeps the canopy from vanishing when seen top-down
    const flat = new PlaneGeometry(r * 2.1, r * 2.1)
    flat.rotateX(-Math.PI / 2)
    flat.translate(x, y, z)
    parts.push(flat.toNonIndexed())
  }
  const merged = mergeGeometries(parts)!
  for (const p of parts) p.dispose()
  foliageCache.set(kind, merged)
  return merged
}
