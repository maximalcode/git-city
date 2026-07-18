import { describe, expect, it } from 'vitest'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import {
  ALTITUDE_BASE,
  ALTITUDE_PER_DEPTH,
  buildFleetModel,
  CAPITAL_MIN_WEIGHT,
  FREIGHTER_MIN_WEIGHT,
  fleetTargets,
  SHIP_CLASS,
  shipClassFor,
  shipScaleFor
} from './fleet'

function snap(index: number, files: { path: string; loc: number }[]): Snapshot {
  return {
    hash: `hash${index}`,
    date: 1700000000 + index * 86400,
    author: 'Alice',
    message: `commit ${index}`,
    index,
    files: files.map((f) => ({
      path: f.path,
      loc: f.loc,
      commits: 1 + index,
      lastTouched: 1700000000,
      lastAuthor: 'Alice',
      binary: false
    }))
  }
}

function analysis(snaps: Snapshot[]): RepoAnalysis {
  return {
    info: { name: 'test', path: 'C:/repos/test', branch: 'main', commitCount: snaps.length },
    snapshots: snaps
  }
}

const FILES = [
  { path: 'src/index.ts', loc: 2000 },
  { path: 'src/app.ts', loc: 400 },
  { path: 'src/util/a.ts', loc: 90 },
  { path: 'src/util/b.ts', loc: 60 },
  { path: 'test/x.test.ts', loc: 200 },
  { path: 'README.md', loc: 50 }
]

describe('shipClassFor / shipScaleFor', () => {
  it('classes follow the weight thresholds', () => {
    expect(shipClassFor(FREIGHTER_MIN_WEIGHT - 1)).toBe(SHIP_CLASS.fighter)
    expect(shipClassFor(FREIGHTER_MIN_WEIGHT)).toBe(SHIP_CLASS.freighter)
    expect(shipClassFor(CAPITAL_MIN_WEIGHT)).toBe(SHIP_CLASS.capital)
  })

  it('scale is clamped and monotonic', () => {
    expect(shipScaleFor(1)).toBe(0.55)
    expect(shipScaleFor(1e9)).toBe(3.5)
    expect(shipScaleFor(400)).toBeGreaterThan(shipScaleFor(100))
  })
})

describe('buildFleetModel', () => {
  const model = buildFleetModel(analysis([snap(0, FILES.slice(0, 3)), snap(1, FILES)]))

  it('creates exactly one ship per union file', () => {
    expect(model.paths).toHaveLength(FILES.length)
    expect(new Set(model.paths)).toEqual(new Set(FILES.map((f) => f.path)))
    expect(model.positions).toHaveLength(FILES.length * 3)
    expect(model.indexOf.get('src/index.ts')).toBeDefined()
  })

  it('altitude stratifies by directory depth', () => {
    const yOf = (p: string): number => model.positions[model.indexOf.get(p)! * 3 + 1]
    expect(yOf('README.md')).toBe(ALTITUDE_BASE)
    expect(yOf('src/index.ts')).toBe(ALTITUDE_BASE + ALTITUDE_PER_DEPTH)
    expect(yOf('src/util/a.ts')).toBe(ALTITUDE_BASE + 2 * ALTITUDE_PER_DEPTH)
  })

  it('assigns classes from union (peak) weight', () => {
    const clsOf = (p: string): number => model.classes[model.indexOf.get(p)!]
    expect(clsOf('src/index.ts')).toBe(SHIP_CLASS.capital)
    expect(clsOf('src/app.ts')).toBe(SHIP_CLASS.freighter)
    expect(clsOf('src/util/a.ts')).toBe(SHIP_CLASS.fighter)
  })

  it('keeps same-altitude ships of different squadrons apart', () => {
    const bigger = Array.from({ length: 80 }, (_, i) => ({
      path: `${['a', 'b', 'c', 'd'][i % 4]}/f${i}.ts`,
      loc: 20 + ((i * 31) % 500)
    }))
    const m = buildFleetModel(analysis([snap(0, bigger)]))
    for (let i = 0; i < m.paths.length; i++) {
      for (let j = i + 1; j < m.paths.length; j++) {
        if (m.squadronOf[i] === m.squadronOf[j]) continue
        if (m.positions[i * 3 + 1] !== m.positions[j * 3 + 1]) continue
        const dx = m.positions[i * 3] - m.positions[j * 3]
        const dz = m.positions[i * 3 + 2] - m.positions[j * 3 + 2]
        expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(0.9)
      }
    }
  })

  it('is deterministic', () => {
    const a = buildFleetModel(analysis([snap(0, FILES)]))
    const b = buildFleetModel(analysis([snap(0, FILES)]))
    expect(a.paths).toEqual(b.paths)
    expect(a.positions).toEqual(b.positions)
    expect(a.classes).toEqual(b.classes)
  })
})

describe('fleetTargets', () => {
  it('scales present files and zeroes absent ones', () => {
    const model = buildFleetModel(analysis([snap(0, FILES.slice(0, 3)), snap(1, FILES)]))
    const early = fleetTargets(model, snap(0, FILES.slice(0, 3)), 'language')
    const late = fleetTargets(model, snap(1, FILES), 'language')
    const i = model.indexOf.get('README.md')!
    expect(early.scales[i]).toBe(0) // not yet created → warp-in later
    expect(late.scales[i]).toBeGreaterThan(0)
    const j = model.indexOf.get('src/index.ts')!
    expect(early.scales[j]).toBeGreaterThan(0)
    // colors populated for present files
    const sum = late.colors[j * 3] + late.colors[j * 3 + 1] + late.colors[j * 3 + 2]
    expect(sum).toBeGreaterThan(0)
  })
})
