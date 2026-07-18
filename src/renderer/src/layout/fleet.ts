/**
 * Fleet layout — the "squadrons by folder" view of a repository.
 *
 * Every file is one ship; a directory is a squadron flying in V-formations
 * over the footprint the treemap would give that directory, at an altitude
 * set by its depth (deeper modules fly higher). Reusing the treemap for
 * squadron footprints inherits its two load-bearing properties: stability
 * across snapshots (the model is built once per analysis over the union of
 * files) and disjointness (squadrons can never collide).
 */

import { Color } from 'three'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import { cityLayout, type Rect } from './treemap'
import { languageOf } from '../lib/languages'
import { buildColorer, type ColorMode } from '../city/colorModes'

export const SHIP_CLASS = { fighter: 0, freighter: 1, capital: 2 } as const
export type ShipClass = (typeof SHIP_CLASS)[keyof typeof SHIP_CLASS]

/** union-weight (peak LOC) thresholds for ship classes */
export const FREIGHTER_MIN_WEIGHT = 150
export const CAPITAL_MIN_WEIGHT = 1500

/** base flight altitude and per-directory-depth increment */
export const ALTITUDE_BASE = 16
export const ALTITUDE_PER_DEPTH = 9

export interface FleetModel {
  /** ship index → file path (same ordering contract as CityModel.paths) */
  paths: string[]
  indexOf: Map<string, number>
  /** xyz per ship (home position; idle bob animates around it) */
  positions: Float32Array
  classes: Uint8Array
  /** per-ship language color (satisfies colorModes' ColorContext) */
  langColors: Color[]
  /** squadron id per ship (for regroup effects / debugging) */
  squadronOf: Uint16Array
  /** base heading per ship (squadrons face along their district's long axis) */
  yaw: Float32Array
  worldSize: number
}

export interface FleetTargets {
  /** per-ship target scale (0 = file absent at this snapshot) */
  scales: Float32Array
  /** per-ship rgb triplets */
  colors: Float32Array
}

export function shipClassFor(weight: number): ShipClass {
  if (weight >= CAPITAL_MIN_WEIGHT) return SHIP_CLASS.capital
  if (weight >= FREIGHTER_MIN_WEIGHT) return SHIP_CLASS.freighter
  return SHIP_CLASS.fighter
}

/**
 * Within-class size variation. The class already encodes the big steps
 * (fighter/freighter/capital hulls differ ~2.5× each), so the per-LOC scale
 * only breathes gently — otherwise a huge capital would overflow its
 * formation slot. Baseline nudged up so the fleet reads as a real armada.
 */
export function shipScaleFor(loc: number): number {
  return Math.min(2.2, Math.max(0.8, 0.95 + 0.18 * Math.log10(loc + 1)))
}

interface Squadron {
  dir: string
  depth: number
  rect: Rect
  files: { path: string; weight: number }[]
}

const WING_SIZE = 9

export function buildFleetModel(analysis: RepoAnalysis): FleetModel {
  // union weights, exactly like buildCityModel — peak LOC per path
  const weights = new Map<string, number>()
  for (const snap of analysis.snapshots) {
    for (const f of snap.files) {
      const w = Math.max(f.loc, 1)
      if ((weights.get(f.path) ?? 0) < w) weights.set(f.path, w)
    }
  }
  const files = Array.from(weights, ([path, weight]) => ({ path, weight }))
  const worldSize = Math.max(90, Math.min(300, Math.sqrt(files.length) * 10))

  // treemap gives every directory a disjoint footprint; squadron = parent dir
  const layout = cityLayout(files, worldSize)
  const depthOf = new Map<string, number>([['', 0]])
  const rectOf = new Map<string, Rect>([
    ['', { x: -worldSize / 2, y: -worldSize / 2, w: worldSize, h: worldSize }]
  ])
  for (const d of layout.districts) {
    depthOf.set(d.path, d.depth)
    rectOf.set(d.path, d.rect)
  }

  const squadrons = new Map<string, Squadron>()
  for (const [path, weight] of weights) {
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    let sq = squadrons.get(dir)
    if (!sq) {
      sq = {
        dir,
        depth: depthOf.get(dir) ?? dir.split('/').length,
        rect: rectOf.get(dir) ?? rectOf.get('')!,
        files: []
      }
      squadrons.set(dir, sq)
    }
    sq.files.push({ path, weight })
  }

  const n = files.length
  const paths: string[] = new Array(n)
  const positions = new Float32Array(n * 3)
  const classes = new Uint8Array(n)
  const squadronOf = new Uint16Array(n)
  const yaw = new Float32Array(n)

  let ship = 0
  let squadronId = 0
  // deterministic order: squadrons sorted by dir path, files by weight desc
  const ordered = [...squadrons.values()].sort((a, b) => (a.dir < b.dir ? -1 : 1))
  for (const sq of ordered) {
    sq.files.sort((a, b) => b.weight - a.weight || (a.path < b.path ? -1 : 1))
    const r = sq.rect
    const y = ALTITUDE_BASE + sq.depth * ALTITUDE_PER_DEPTH
    const cx = r.x + r.w / 2
    const cz = r.y + r.h / 2
    // formation axes: V opens backward along the district's long side
    const alongX = r.w >= r.h
    const k = sq.files.length
    const wings = Math.ceil(k / WING_SIZE)
    // spacing sized for the (now larger) hulls: tight enough to read as one
    // formation, loose enough not to overlap
    const g = Math.min(6, Math.max(2.6, Math.min(r.w, r.h) / (2 * Math.sqrt(k) + 1)))

    for (let i = 0; i < k; i++) {
      const wing = Math.floor(i / WING_SIZE)
      const slot = i % WING_SIZE
      const row = Math.ceil(slot / 2)
      const side = slot === 0 ? 0 : slot % 2 === 1 ? 1 : -1
      // wing centers spread across the short axis
      const wingOff = wings > 1 ? ((wing + 0.5) / wings - 0.5) * 0.6 * Math.min(r.w, r.h) : 0
      const back = -row * g
      const lateral = side * row * 0.9 * g
      let x = alongX ? cx + back : cx + lateral
      let z = alongX ? cz + lateral : cz + back
      if (alongX) z += wingOff
      else x += wingOff
      // squadrons stay inside their (disjoint) footprint
      x = Math.min(r.x + r.w - 0.5, Math.max(r.x + 0.5, x))
      z = Math.min(r.y + r.h - 0.5, Math.max(r.y + 0.5, z))

      const f = sq.files[i]
      paths[ship] = f.path
      positions[ship * 3] = x
      positions[ship * 3 + 1] = y
      positions[ship * 3 + 2] = z
      classes[ship] = shipClassFor(f.weight)
      squadronOf[ship] = squadronId
      // hulls face +X; squadrons flying along z turn to face +Z
      yaw[ship] = alongX ? 0 : -Math.PI / 2
      ship++
    }
    squadronId++
  }

  const indexOf = new Map(paths.map((p, i) => [p, i]))
  const langColors = paths.map((p) => new Color(languageOf(p).color))
  return { paths, indexOf, positions, classes, langColors, squadronOf, yaw, worldSize }
}

const scratch = new Color()

export function fleetTargets(
  model: FleetModel,
  snapshot: Snapshot,
  colorMode: ColorMode
): FleetTargets {
  const n = model.paths.length
  const scales = new Float32Array(n)
  const colors = new Float32Array(n * 3)

  const byPath = new Map(snapshot.files.map((f) => [f.path, f]))
  const colorer = buildColorer(model, snapshot, colorMode)

  for (let i = 0; i < n; i++) {
    const f = byPath.get(model.paths[i])
    if (!f) continue
    scales[i] = shipScaleFor(f.loc)
    const c = colorer.colorFor(f, i, scratch)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  return { scales, colors }
}
