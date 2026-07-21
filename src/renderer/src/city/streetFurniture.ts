import type { RoadGraph } from '../layout/roads'
import { junctionHalfSizes, roadY, sidewalkWidthFor } from './roadGeometry'

/**
 * Deterministic placement of street furniture that makes roads read as real
 * streets: parked cars along wide avenues, stop lines at junction approaches,
 * manhole covers on the carriageway, and traffic lights at big junctions.
 * Pure data — the StreetDetail component turns these into instanced meshes.
 * No Math.random anywhere: identical city every build.
 */

export interface ParkedCar {
  x: number
  z: number
  y: number
  /** yaw, radians */
  angle: number
  /** palette index (renderer maps to a muted color list) */
  tint: number
}

export interface StopLine {
  x: number
  z: number
  y: number
  /** yaw of the line quad (across the approach lane) */
  angle: number
  /** length of the line (half the road width — right-hand lane only) */
  length: number
}

export interface Manhole {
  x: number
  z: number
  y: number
}

export interface TrafficLight {
  x: number
  z: number
  y: number
  /** yaw so the head faces the junction center */
  angle: number
  /** deterministic phase: 0 = red, 1 = green */
  phase: number
}

/** roads narrower than this get no parking lane (would clip moving traffic) */
export const PARK_MIN_WIDTH = 3.2
/** moving traffic keeps within this centerline offset (must match Traffic.tsx) */
export const LANE_OFFSET_CAP = 0.5
/** half-width of the widest parked body incl. wheel bulge (van: 0.41 body +
 *  0.03 wheel overhang; see trafficShapes BODIES) */
export const CAR_HALF_WIDTH = 0.45
/** distance between parked-car slot centers, world units (bodies are ~2 long) */
const PARK_PITCH = 2.5
/** fraction of slots deliberately left empty */
const PARK_VACANCY = 0.28
/** junctions whose max road is at least this wide get traffic lights */
const LIGHT_MIN_WIDTH = 1.8
/** one manhole roughly every this many world units of street */
const MANHOLE_PITCH = 9

function pseudo(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export interface StreetDetailData {
  parked: ParkedCar[]
  stopLines: StopLine[]
  manholes: Manhole[]
  lights: TrafficLight[]
}

/**
 * `agentScale` matches Traffic's vehicle scale (min(1, citySize/140)) so
 * parked and moving cars are the same size.
 */
export function buildStreetDetail(graph: RoadGraph, agentScale: number): StreetDetailData {
  const jHalf = junctionHalfSizes(graph)
  const parked: ParkedCar[] = []
  const stopLines: StopLine[] = []
  const manholes: Manhole[] = []
  const lights: TrafficLight[] = []

  graph.edges.forEach((e, ei) => {
    const na = graph.nodes[e.a]
    const nb = graph.nodes[e.b]
    const y = roadY(e.depth)
    const half = e.width / 2
    const sw = sidewalkWidthFor(e.width)
    const trimA = jHalf[e.a] ?? 0
    const trimB = jHalf[e.b] ?? 0
    const usable = e.length - trimA - trimB

    // --- parked cars: only where the parking lane clears the driving lane ---
    const carHalf = CAR_HALF_WIDTH * agentScale
    // parked row hugs the curb: outer edge just inside the sidewalk
    const parkOff = half - sw - carHalf
    // outer edge of the moving lane (lane center + a body half-width)
    const laneEdge = Math.min(e.width * 0.22, LANE_OFFSET_CAP) * agentScale + carHalf
    const clears = parkOff - carHalf > laneEdge + 0.05
    if (e.width >= PARK_MIN_WIDTH && clears && usable > PARK_PITCH) {
      const slots = Math.floor(usable / PARK_PITCH)
      for (let s = 0; s < slots; s++) {
        for (const side of [1, -1]) {
          const r = pseudo(ei * 131 + s * 7 + (side === 1 ? 0 : 3))
          if (r < PARK_VACANCY) continue
          const along = trimA + (s + 0.5) * PARK_PITCH
          const jitter = (pseudo(ei * 17 + s * 29 + side) - 0.5) * 0.6
          if (e.axis === 'x') {
            const dir = Math.sign(nb.x - na.x) || 1
            parked.push({
              x: Math.min(na.x, nb.x) + along + jitter,
              z: na.z + side * parkOff,
              y,
              angle: dir * side > 0 ? 0 : Math.PI,
              tint: Math.floor(r * 64)
            })
          } else {
            const dir = Math.sign(nb.z - na.z) || 1
            parked.push({
              x: na.x + side * parkOff,
              z: Math.min(na.z, nb.z) + along + jitter,
              y,
              angle: dir * side > 0 ? Math.PI / 2 : -Math.PI / 2,
              tint: Math.floor(r * 64)
            })
          }
        }
      }
    }

    // --- manholes: staggered down the centerline ---
    const holes = Math.floor(usable / MANHOLE_PITCH)
    for (let m = 0; m < holes; m++) {
      const along = trimA + (m + 0.5) * MANHOLE_PITCH + (pseudo(ei * 47 + m) - 0.5) * 2
      const off = (pseudo(ei * 53 + m) - 0.5) * e.width * 0.3
      if (along < trimA || along > e.length - trimB) continue
      if (e.axis === 'x') {
        manholes.push({ x: Math.min(na.x, nb.x) + along, z: na.z + off, y })
      } else {
        manholes.push({ x: na.x + off, z: Math.min(na.z, nb.z) + along, y })
      }
    }
  })

  // --- per junction: stop lines on every approach + lights on big ones ---
  graph.nodes.forEach((n, ni) => {
    const half = jHalf[ni]
    if (half === null) return
    const maxW = Math.max(...graph.adjacency[ni].map((ei) => graph.edges[ei].width))
    const wantsLights = maxW >= LIGHT_MIN_WIDTH
    for (const ei of graph.adjacency[ni]) {
      const e = graph.edges[ei]
      if (e.width < 1.1) continue
      const other = graph.nodes[e.a === ni ? e.b : e.a]
      const y = roadY(e.depth) + 0.009
      const qtr = e.width / 4
      const stopAt = half + 0.28
      if (e.axis === 'x') {
        const sign = Math.sign(other.x - n.x) || 1
        if (Math.abs(other.x - n.x) < stopAt + 0.4) continue
        // right-hand-traffic: the lane ENTERING the junction from this arm
        stopLines.push({
          x: n.x + sign * stopAt,
          z: n.z + sign * qtr,
          y,
          angle: Math.PI / 2,
          length: e.width / 2 - 0.08
        })
      } else {
        const sign = Math.sign(other.z - n.z) || 1
        if (Math.abs(other.z - n.z) < stopAt + 0.4) continue
        stopLines.push({
          x: n.x - sign * qtr,
          z: n.z + sign * stopAt,
          y,
          angle: 0,
          length: e.width / 2 - 0.08
        })
      }
    }
    if (wantsLights) {
      const y = roadY(Math.min(...graph.adjacency[ni].map((ei) => graph.edges[ei].depth)))
      // two lights on diagonal corners, facing the junction center
      for (const [cx, cz] of [
        [1, 1],
        [-1, -1]
      ]) {
        lights.push({
          x: n.x + cx * (half + 0.22),
          z: n.z + cz * (half + 0.22),
          y,
          angle: Math.atan2(-cz, -cx),
          phase: pseudo(ni * 91 + cx) > 0.5 ? 1 : 0
        })
      }
    }
  })

  return { parked, stopLines, manholes, lights }
}
