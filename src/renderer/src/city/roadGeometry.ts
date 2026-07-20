/**
 * Static street geometry built from the road graph. Three separate meshes so a
 * street reads as a real street rather than a coloured line on the ground:
 *
 *  - `asphalt`   the driving surface (textured: asphalt + dashed centreline),
 *                trimmed back from junction squares so surfaces never stack.
 *  - `sidewalk`  raised concrete slabs flanking each road, with a vertical curb
 *                face toward the carriageway. Grayscale vertex colours (top 1.0,
 *                curb face 0.62) multiply the theme's single sidewalk colour so
 *                the curb reads as a shaded step. One draw call.
 *  - `crosswalk` zebra bars laid across each wide road as it enters a junction.
 *
 * The asphalt keeps the same UV contract as before: u = world-units along the
 * street / DASH_PERIOD (continuous across junction-split edges), v = 0..1 across
 * the width. Junction squares live in their own `junction` geometry with
 * world-planar UVs, so the centerline-marking overlay (drawn only on `asphalt`)
 * never crosses a junction.
 */

import { BufferAttribute, BufferGeometry } from 'three'
import type { RoadGraph } from '../layout/roads'

/** world units per dash cycle in the road texture */
export const DASH_PERIOD = 4

/** height of the curb / raised sidewalk above the carriageway */
const CURB_H = 0.16
/** roads narrower than this get no sidewalk (would be all curb, no road) */
const SW_MIN_WIDTH = 1.0
/** zebra crosswalks only on roads at least this wide */
const CW_MIN_WIDTH = 1.1

export interface RoadGeometry {
  asphalt: BufferGeometry
  /** junction squares: same material as asphalt but real (world) UVs — kept
   *  separate so the centerline-marking overlay never covers a junction */
  junction: BufferGeometry
  sidewalk: BufferGeometry
  crosswalk: BufferGeometry
}

/** top surface of the district plate a road of this depth lies on */
export function roadY(depth: number): number {
  return depth > 0 ? depth * 0.09 + 0.06 + 0.004 : 0.004
}

export function sidewalkWidthFor(width: number): number {
  if (width < SW_MIN_WIDTH) return 0
  return Math.min(Math.max(width * 0.2, 0.22), 0.7)
}

/**
 * Junction square half-sizes per node (null = no junction there): a junction
 * exists where edges of both axes meet (T or X) or 3+ edges meet. Exported so
 * street-detail placement (stop lines, traffic lights, parked cars) agrees
 * exactly with the rendered junction squares.
 */
export function junctionHalfSizes(graph: RoadGraph): (number | null)[] {
  return graph.nodes.map((_, ni) => {
    const inc = graph.adjacency[ni]
    if (inc.length < 2) return null
    const axes = new Set(inc.map((ei) => graph.edges[ei].axis))
    if (inc.length === 2 && axes.size === 1) return null
    return Math.max(...inc.map((ei) => graph.edges[ei].width)) / 2
  })
}

/** world units per paving-texture tile on sidewalks (and other soup surfaces) */
export const PAVING_TILE = 1.7

/**
 * Planar UV by dominant normal axis: tops map from the ground plane (xz), curb
 * faces map from their wall plane — so a world-space paving texture runs
 * seamlessly along strips regardless of quad orientation. Pure + exported for
 * tests.
 */
export function planarUV(
  nx: number,
  ny: number,
  nz: number,
  x: number,
  y: number,
  z: number
): [number, number] {
  if (Math.abs(ny) >= 0.5) return [x / PAVING_TILE, z / PAVING_TILE]
  if (Math.abs(nx) >= 0.5) return [z / PAVING_TILE, y / PAVING_TILE]
  return [x / PAVING_TILE, y / PAVING_TILE]
}

/** A growing triangle soup with position + normal + uv (+ optional color). */
class Soup {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  col: number[] = []
  withColor: boolean
  constructor(withColor: boolean) {
    this.withColor = withColor
  }
  /** two triangles (a,b,c)(a,c,d); normal from the winding, doubled-sided lit. */
  quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    color = 1
  ): void {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    for (const v of [a, b, c, a, c, d]) {
      this.pos.push(v[0], v[1], v[2])
      this.nrm.push(nx, ny, nz)
      const [tu, tv] = planarUV(nx, ny, nz, v[0], v[1], v[2])
      this.uv.push(tu, tv)
      if (this.withColor) this.col.push(color, color, color)
    }
  }
  build(): BufferGeometry {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2))
    if (this.withColor) geo.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    return geo
  }
}

export function buildRoadGeometry(graph: RoadGraph): RoadGeometry {
  interface Quad {
    xs: [number, number, number, number]
    zs: [number, number, number, number]
    y: number
    uvs: [number, number][]
  }
  const asphaltQuads: Quad[] = []
  const junctionQuads: Quad[] = []
  const sidewalk = new Soup(true)
  const crosswalk = new Soup(false)

  const jHalf = junctionHalfSizes(graph)

  for (const e of graph.edges) {
    const na = graph.nodes[e.a]
    const nb = graph.nodes[e.b]
    const y = roadY(e.depth)
    const half = e.width / 2
    const sw = sidewalkWidthFor(e.width)
    // trim the asphalt back from junction squares so surfaces never stack
    const trimA = jHalf[e.a] ?? 0
    const trimB = jHalf[e.b] ?? 0

    if (e.axis === 'z') {
      const x = na.x
      const z0 =
        Math.min(na.z, nb.z) + trimA * (na.z < nb.z ? 1 : 0) + trimB * (nb.z < na.z ? 1 : 0)
      const z1 =
        Math.max(na.z, nb.z) - trimA * (na.z > nb.z ? 1 : 0) - trimB * (nb.z > na.z ? 1 : 0)
      if (z1 - z0 >= 0.05) {
        asphaltQuads.push({
          xs: [x - half, x + half, x + half, x - half],
          zs: [z0, z0, z1, z1],
          y,
          uvs: [
            [z0 / DASH_PERIOD, 0],
            [z0 / DASH_PERIOD, 1],
            [z1 / DASH_PERIOD, 1],
            [z1 / DASH_PERIOD, 0]
          ]
        })
      }
      // sidewalks run the full (untrimmed) extent so they stay continuous
      if (sw > 0) {
        const wz0 = Math.min(na.z, nb.z)
        const wz1 = Math.max(na.z, nb.z)
        curbStripZ(sidewalk, x + half - sw, x + half, wz0, wz1, y, -1)
        curbStripZ(sidewalk, x - half, x - half + sw, wz0, wz1, y, 1)
      }
    } else {
      const z = na.z
      const x0 =
        Math.min(na.x, nb.x) + trimA * (na.x < nb.x ? 1 : 0) + trimB * (nb.x < na.x ? 1 : 0)
      const x1 =
        Math.max(na.x, nb.x) - trimA * (na.x > nb.x ? 1 : 0) - trimB * (nb.x > na.x ? 1 : 0)
      if (x1 - x0 >= 0.05) {
        asphaltQuads.push({
          xs: [x0, x0, x1, x1],
          zs: [z - half, z + half, z + half, z - half],
          y,
          uvs: [
            [x0 / DASH_PERIOD, 0],
            [x0 / DASH_PERIOD, 1],
            [x1 / DASH_PERIOD, 1],
            [x1 / DASH_PERIOD, 0]
          ]
        })
      }
      if (sw > 0) {
        const wx0 = Math.min(na.x, nb.x)
        const wx1 = Math.max(na.x, nb.x)
        curbStripX(sidewalk, wx0, wx1, z + half - sw, z + half, y, -1)
        curbStripX(sidewalk, wx0, wx1, z - half, z - half + sw, y, 1)
      }
    }
  }

  // junction squares sit a hair above the street quads (lowest incident plate)
  graph.nodes.forEach((n, ni) => {
    const half = jHalf[ni]
    if (half === null) return
    const y = roadY(Math.min(...graph.adjacency[ni].map((ei) => graph.edges[ei].depth))) + 0.002
    // world-planar UVs: the junction samples the asphalt photo at street density
    junctionQuads.push({
      xs: [n.x - half, n.x + half, n.x + half, n.x - half],
      zs: [n.z - half, n.z - half, n.z + half, n.z + half],
      y,
      uvs: [
        [(n.x - half) / DASH_PERIOD, (n.z - half) / DASH_PERIOD],
        [(n.x + half) / DASH_PERIOD, (n.z - half) / DASH_PERIOD],
        [(n.x + half) / DASH_PERIOD, (n.z + half) / DASH_PERIOD],
        [(n.x - half) / DASH_PERIOD, (n.z + half) / DASH_PERIOD]
      ]
    })
    // zebra crossings as each wide road enters this junction
    for (const ei of graph.adjacency[ni]) {
      const e = graph.edges[ei]
      if (e.width < CW_MIN_WIDTH) continue
      emitCrosswalk(crosswalk, graph, ni, ei, half)
    }
  })

  // --- assemble the textured surfaces (normals all +Y, uv per quad) ---
  const buildQuads = (quads: Quad[]): BufferGeometry => {
    const positions = new Float32Array(quads.length * 6 * 3)
    const normals = new Float32Array(quads.length * 6 * 3)
    const uvs = new Float32Array(quads.length * 6 * 2)
    const order = [0, 2, 1, 0, 3, 2] // two CCW triangles seen from +Y
    quads.forEach((q, qi) => {
      for (let v = 0; v < 6; v++) {
        const c = order[v]
        const o = (qi * 6 + v) * 3
        positions[o] = q.xs[c]
        positions[o + 1] = q.y
        positions[o + 2] = q.zs[c]
        normals[o + 1] = 1
        const uo = (qi * 6 + v) * 2
        uvs[uo] = q.uvs[c][0]
        uvs[uo + 1] = q.uvs[c][1]
      }
    })
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setAttribute('normal', new BufferAttribute(normals, 3))
    geo.setAttribute('uv', new BufferAttribute(uvs, 2))
    return geo
  }

  return {
    asphalt: buildQuads(asphaltQuads),
    junction: buildQuads(junctionQuads),
    sidewalk: sidewalk.build(),
    crosswalk: crosswalk.build()
  }
}

/**
 * A raised sidewalk slab running along z at x in [xi, xo]: a concrete top plus a
 * curb face on the side toward the road. `faceSide` is +1 if the road is at
 * larger x (curb face on the xo side... actually inner side toward the road).
 */
function curbStripZ(
  soup: Soup,
  xLo: number,
  xHi: number,
  z0: number,
  z1: number,
  baseY: number,
  roadDir: 1 | -1
): void {
  const topY = baseY + CURB_H
  // top slab
  soup.quad([xLo, topY, z0], [xHi, topY, z0], [xHi, topY, z1], [xLo, topY, z1], 1)
  // curb face toward the carriageway (roadDir = +1 → road is at smaller x → face at xLo)
  const fx = roadDir === 1 ? xLo : xHi
  soup.quad([fx, baseY, z0], [fx, topY, z0], [fx, topY, z1], [fx, baseY, z1], 0.62)
}

/** Raised sidewalk slab running along x at z in [zLo, zHi]. */
function curbStripX(
  soup: Soup,
  x0: number,
  x1: number,
  zLo: number,
  zHi: number,
  baseY: number,
  roadDir: 1 | -1
): void {
  const topY = baseY + CURB_H
  soup.quad([x0, topY, zLo], [x1, topY, zLo], [x1, topY, zHi], [x0, topY, zHi], 1)
  const fz = roadDir === 1 ? zLo : zHi
  soup.quad([x0, baseY, fz], [x1, baseY, fz], [x1, topY, fz], [x0, topY, fz], 0.62)
}

const STRIPE = 0.22 // bar thickness along travel
const STRIPE_GAP = 0.2
const CW_STRIPES = 4

/** Zebra bars across a road as it enters a junction, just outside the square. */
function emitCrosswalk(
  soup: Soup,
  graph: RoadGraph,
  node: number,
  edge: number,
  jHalf: number
): void {
  const e = graph.edges[edge]
  const n = graph.nodes[node]
  const other = graph.nodes[e.a === node ? e.b : e.a]
  const half = e.width / 2
  const y = roadY(e.depth) + 0.008
  const start = jHalf + 0.06
  if (e.axis === 'x') {
    const sign = Math.sign(other.x - n.x) || 1
    // available road length outside the junction on this side
    const room = Math.abs(other.x - n.x) - jHalf - 0.1
    for (let i = 0; i < CW_STRIPES; i++) {
      const off = start + i * (STRIPE + STRIPE_GAP)
      if (off + STRIPE > room) break
      const bx0 = n.x + sign * off
      const bx1 = n.x + sign * (off + STRIPE)
      const zA = n.z - half
      const zB = n.z + half
      soup.quad([bx0, y, zA], [bx1, y, zA], [bx1, y, zB], [bx0, y, zB], 1)
    }
  } else {
    const sign = Math.sign(other.z - n.z) || 1
    const room = Math.abs(other.z - n.z) - jHalf - 0.1
    for (let i = 0; i < CW_STRIPES; i++) {
      const off = start + i * (STRIPE + STRIPE_GAP)
      if (off + STRIPE > room) break
      const bz0 = n.z + sign * off
      const bz1 = n.z + sign * (off + STRIPE)
      const xA = n.x - half
      const xB = n.x + half
      soup.quad([xA, y, bz0], [xA, y, bz1], [xB, y, bz1], [xB, y, bz0], 1)
    }
  }
}
