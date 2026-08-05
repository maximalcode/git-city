import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferGeometry
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Hand-built farm props, merged from primitives (no drei, no external models),
 * following the same recipe as the trees and vehicles.
 *
 * Everything is modelled with its base on the origin, growing +Y, facing +X —
 * so an instance's matrix only ever has to place and turn it.
 *
 * Barns, silos and animals carry baked vertex colours, because one instanced
 * mesh draws the whole herd and a per-instance colour would make every cow the
 * same flat shade. Fences and crops are painted per instance instead, since
 * those follow the field's colour-mode hue.
 */

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
 * Merge after stripping indices — three's primitives disagree on indexing and
 * mergeGeometries refuses a mixed set (same reason as trafficShapes).
 */
function merge(parts: BufferGeometry[]): BufferGeometry {
  const nonIndexed = parts.map((g) => g.toNonIndexed())
  const merged = mergeGeometries(nonIndexed)!
  for (const g of parts) g.dispose()
  for (const g of nonIndexed) g.dispose()
  return merged
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): BoxGeometry {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y + h / 2, z)
  return g
}

/**
 * A barn: red board walls, a pitched roof, and the white trim around the big
 * door that makes the silhouette read as a barn rather than a shed.
 */
export function barnGeometry(): BufferGeometry {
  const walls = paint(box(6.4, 3.4, 4.4), 0.44, 0.09, 0.08)
  // roof: a 4-sided cone is a pitched roof once it is turned 45° and squashed
  const roofGeo = new ConeGeometry(3.9, 2.1, 4)
  roofGeo.rotateY(Math.PI / 4)
  roofGeo.scale(1, 1, 0.79)
  roofGeo.translate(0, 3.4 + 1.05, 0)
  const roof = paint(roofGeo, 0.22, 0.2, 0.22)
  const door = paint(box(0.25, 2.2, 2.0, 3.2, 0, 0), 0.86, 0.85, 0.8)
  const trim = paint(box(0.18, 0.22, 2.5, 3.18, 2.2, 0), 0.86, 0.85, 0.8)
  // The yard lamp's post. It stands whatever the theme is doing — only the head
  // is emissive, and that lives in farmGlowGeometry so it can be left out
  // entirely under Daylight (#22).
  const lampPost = paint(box(0.16, LAMP_HEIGHT, 0.16, LAMP_X, 0, LAMP_Z), 0.24, 0.23, 0.22)
  return merge([walls, roof, door, trim, lampPost])
}

/** Where the yard lamp stands, in the barn's own local space. */
const LAMP_X = -3.6
const LAMP_Z = 2.4
const LAMP_HEIGHT = 3.2

/**
 * The lit parts of a farmstead, as one geometry sharing the barn's instance
 * matrix: two hayloft windows, the doorway spill, and the yard lamp's head.
 *
 * Separate from the barn because it is drawn with an unlit emissive material,
 * and because the dark themes are the only ones that want it. This is the
 * farm's answer to the city's window grids — under Night the city is composed
 * entirely of lit windows, and the farm had no equivalent, so it read as a dim
 * field of rectangles rather than a place at night (#22).
 */
export function farmGlowGeometry(): BufferGeometry {
  // proud of the wall by a hair so they never z-fight with the boards
  const w = 3.22
  const loftLeft = box(0.06, 0.5, 0.55, w, 2.35, -1.05)
  const loftRight = box(0.06, 0.5, 0.55, w, 2.35, 1.05)
  // the gap under the big door, which is where the light actually falls
  const doorSpill = box(0.06, 0.45, 1.7, w, 0.05, 0)
  // a small window on the long side, so the barn is not dark from three angles
  const side = box(0.5, 0.45, 0.06, 0.9, 1.5, 2.22)
  const lampHead = box(0.42, 0.3, 0.42, LAMP_X, LAMP_HEIGHT, LAMP_Z)
  return merge([loftLeft, loftRight, doorSpill, side, lampHead])
}

/** A grain silo: corrugated cylinder under a domed cap. */
export function siloGeometry(): BufferGeometry {
  const body = paint(new CylinderGeometry(1.25, 1.3, 6, 14), 0.62, 0.63, 0.6)
  body.translate(0, 3, 0)
  const capGeo = new SphereGeometry(1.28, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  capGeo.translate(0, 6, 0)
  const cap = paint(capGeo, 0.44, 0.45, 0.47)
  return merge([body, cap])
}

/** One fence post with its two rails, running along +X. */
export function fenceGeometry(): BufferGeometry {
  const post = box(0.12, 0.85, 0.12)
  const railLow = box(2.0, 0.08, 0.06, 1, 0.28, 0)
  const railHigh = box(2.0, 0.08, 0.06, 1, 0.6, 0)
  return merge([post, railLow, railHigh])
}

/**
 * A wind pump — the tall lattice tower that says "this is a big holding" from
 * across the map, and gives the farm a vertical accent the fields cannot.
 */
export function windPumpGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  // four splayed legs
  for (const [dx, dz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ]) {
    const leg = new BoxGeometry(0.1, 5.2, 0.1)
    leg.translate(dx * 0.45, 2.6, dz * 0.45)
    // lean each leg inward so the tower tapers
    leg.rotateX(dz * 0.075)
    leg.rotateZ(-dx * 0.075)
    parts.push(paint(leg, 0.42, 0.4, 0.36))
  }
  parts.push(paint(box(1.0, 0.08, 1.0, 0, 2.4, 0), 0.42, 0.4, 0.36))
  const hub = paint(new CylinderGeometry(0.22, 0.22, 0.24, 8), 0.5, 0.48, 0.44)
  hub.rotateZ(Math.PI / 2)
  hub.translate(0, 5.3, 0)
  parts.push(hub)
  // blades as a fan of thin plates around the hub
  for (let i = 0; i < 6; i++) {
    const blade = new BoxGeometry(0.06, 1.5, 0.34)
    blade.translate(0, 0.85, 0)
    blade.rotateX((i / 6) * Math.PI * 2)
    blade.translate(0.14, 5.3, 0)
    parts.push(paint(blade, 0.72, 0.72, 0.68))
  }
  return merge(parts)
}

/**
 * What grows on a field, by crop class. All three are modelled to a unit height
 * so the instance's Y scale is the live line count, and left unpainted so the
 * field's colour-mode hue comes through per instance.
 *
 * The three read differently on purpose: a big file should look like a
 * different kind of agriculture from a small one, not the same crop taller.
 */
export function cropGeometry(kind: CropShape): BufferGeometry {
  if (kind === 'furrow') return furrowGeometry()
  if (kind === 'orchard') return orchardGeometry()
  return rowGeometry()
}

export type CropShape = 'furrow' | 'row' | 'orchard'

/** Low leafy vegetable mounds — small files sit close to the ground. */
function furrowGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const [x, z, r] of [
    [0, 0, 0.19],
    [0.2, 0.12, 0.14],
    [-0.17, -0.1, 0.13]
  ] as [number, number, number][]) {
    const leaf = new SphereGeometry(r, 7, 5)
    // squashed: a cabbage sits wide and low, and unit height keeps Y as the scale
    leaf.scale(1.5, 0.9, 1.5)
    leaf.translate(x, r * 0.75, z)
    parts.push(leaf)
  }
  return merge(parts)
}

/** Standing cereal — a stook of tapered blades, the mid-size default. */
function rowGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const blades: [number, number, number, number][] = [
    [0, 0, 1, 0],
    [0.16, 0.1, 0.82, 0.22],
    [-0.14, -0.08, 0.78, -0.2],
    [0.04, -0.16, 0.7, 0.12]
  ]
  for (const [x, z, h, lean] of blades) {
    const blade = new ConeGeometry(0.11, h, 4)
    blade.translate(0, h / 2, 0)
    blade.rotateZ(lean)
    blade.translate(x, 0, z)
    parts.push(blade)
  }
  return merge(parts)
}

/** A fruit tree — the big files become orchards rather than very tall wheat. */
function orchardGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.05, 0.075, 0.42, 6)
  trunk.translate(0, 0.21, 0)
  const canopy = new SphereGeometry(0.3, 8, 6)
  canopy.scale(1, 0.88, 1)
  canopy.translate(0, 0.68, 0)
  const side = new SphereGeometry(0.19, 7, 5)
  side.translate(0.19, 0.55, 0.06)
  return merge([trunk, canopy, side])
}

/* ---------------------------------------------------------------- animals */

export type AnimalKind = 'cow' | 'sheep' | 'pig' | 'chicken'
export const ANIMAL_KINDS: AnimalKind[] = ['cow', 'sheep', 'pig', 'chicken']

/** Four legs under a body of height `h`, spanning `len` × `wid`. */
function legs(len: number, wid: number, h: number, r: number, g: number, b: number, thick = 0.07) {
  const out: BufferGeometry[] = []
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      out.push(paint(box(thick, h, thick, (dx * len) / 2, 0, (dz * wid) / 2), r, g, b))
    }
  }
  return out
}

function cowGeometry(): BufferGeometry {
  const H = 0.42
  const body = paint(box(1.05, 0.5, 0.5, 0, H, 0), 0.9, 0.89, 0.87)
  // two patches, so a herd of white blocks reads as cattle
  const patchA = paint(box(0.3, 0.52, 0.34, 0.18, H - 0.01, 0.09), 0.16, 0.13, 0.12)
  const patchB = paint(box(0.22, 0.3, 0.52, -0.3, H + 0.18, 0), 0.16, 0.13, 0.12)
  const head = paint(box(0.34, 0.3, 0.3, 0.66, H + 0.12, 0), 0.9, 0.89, 0.87)
  const muzzle = paint(box(0.14, 0.16, 0.2, 0.86, H + 0.16, 0), 0.75, 0.6, 0.6)
  const tail = paint(box(0.06, 0.36, 0.06, -0.54, H + 0.12, 0), 0.16, 0.13, 0.12)
  return merge([body, patchA, patchB, head, muzzle, tail, ...legs(0.72, 0.34, H, 0.2, 0.17, 0.15)])
}

function sheepGeometry(): BufferGeometry {
  const H = 0.3
  const fleece = paint(new SphereGeometry(0.34, 10, 7), 0.93, 0.92, 0.88)
  fleece.scale(1.25, 0.95, 1)
  fleece.translate(0, H + 0.26, 0)
  const head = paint(box(0.2, 0.22, 0.2, 0.42, H + 0.2, 0), 0.22, 0.2, 0.2)
  return merge([fleece, head, ...legs(0.44, 0.26, H, 0.22, 0.2, 0.2, 0.055)])
}

function pigGeometry(): BufferGeometry {
  const H = 0.26
  const body = paint(new SphereGeometry(0.3, 10, 7), 0.88, 0.66, 0.66)
  body.scale(1.5, 0.92, 1)
  body.translate(0, H + 0.2, 0)
  const head = paint(box(0.24, 0.22, 0.24, 0.44, H + 0.14, 0), 0.88, 0.66, 0.66)
  const snout = paint(box(0.1, 0.12, 0.14, 0.6, H + 0.16, 0), 0.78, 0.52, 0.54)
  return merge([body, head, snout, ...legs(0.4, 0.28, H, 0.7, 0.5, 0.5, 0.06)])
}

function chickenGeometry(): BufferGeometry {
  const H = 0.12
  const body = paint(new SphereGeometry(0.15, 8, 6), 0.94, 0.93, 0.9)
  body.scale(1.3, 1, 1)
  body.translate(0, H + 0.12, 0)
  const head = paint(new SphereGeometry(0.08, 8, 6), 0.94, 0.93, 0.9)
  head.translate(0.19, H + 0.26, 0)
  const comb = paint(box(0.04, 0.07, 0.03, 0.19, H + 0.32, 0), 0.8, 0.16, 0.14)
  const beak = paint(box(0.07, 0.04, 0.04, 0.27, H + 0.25, 0), 0.9, 0.68, 0.2)
  return merge([body, head, comb, beak, ...legs(0.14, 0.12, H, 0.85, 0.62, 0.18, 0.035)])
}

const animalCache = new Map<AnimalKind, BufferGeometry>()

export function animalGeometry(kind: AnimalKind): BufferGeometry {
  let g = animalCache.get(kind)
  if (!g) {
    g =
      kind === 'cow'
        ? cowGeometry()
        : kind === 'sheep'
          ? sheepGeometry()
          : kind === 'pig'
            ? pigGeometry()
            : chickenGeometry()
    animalCache.set(kind, g)
  }
  return g
}

/** How fast each kind ambles, in world units per second. */
export const ANIMAL_SPEED: Record<AnimalKind, number> = {
  cow: 0.35,
  sheep: 0.5,
  pig: 0.42,
  chicken: 0.75
}

/**
 * A tractor: green body, yellow cab, and the big-rear-small-front wheels that
 * are the whole silhouette. Faces +X like everything else here, so the track
 * walker only has to place and turn it.
 *
 * Built at roughly a car's scale so it reads at the same camera distance the
 * city's traffic does.
 */
export function tractorGeometry(): BufferGeometry {
  const body = paint(box(1.5, 0.5, 0.72, 0, 0.34, 0), 0.13, 0.42, 0.16)
  const bonnet = paint(box(0.72, 0.3, 0.6, 0.42, 0.62, 0), 0.13, 0.42, 0.16)
  const cab = paint(box(0.56, 0.56, 0.62, -0.3, 0.62, 0), 0.85, 0.72, 0.12)
  // exhaust stack — small, but it is what makes the shape read as a tractor
  const stack = paint(box(0.09, 0.42, 0.09, 0.2, 1.0, 0.22), 0.22, 0.22, 0.24)

  const wheel = (x: number, z: number, r: number): BufferGeometry => {
    const g = new CylinderGeometry(r, r, 0.16, 10)
    g.rotateX(Math.PI / 2)
    g.translate(x, r, z)
    return paint(g, 0.11, 0.11, 0.12)
  }
  return merge([
    body,
    bonnet,
    cab,
    stack,
    wheel(-0.36, 0.42, 0.44),
    wheel(-0.36, -0.42, 0.44),
    wheel(0.52, 0.38, 0.24),
    wheel(0.52, -0.38, 0.24)
  ])
}

/**
 * How many tractors work a holding, from the number of tracks.
 *
 * Deliberately far sparser than the city's traffic, which scales at 0.4 agents
 * per street segment. A farm with rush-hour density would read as a depot, not
 * a farm — the point is that the tracks are *used*, not busy (#52).
 */
export function tractorCount(trackCount: number): number {
  if (trackCount < 4) return 0
  return Math.min(12, Math.max(1, Math.round(trackCount * 0.02)))
}
