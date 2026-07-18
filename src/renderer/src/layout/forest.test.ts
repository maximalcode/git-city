import { describe, expect, it } from 'vitest'
import type { RepoAnalysis, Snapshot } from '../../../shared/types'
import { TREE_KINDS } from '../city/treeShapes'
import { buildForestModel, forestTargets, treeScaleFor } from './forest'

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

describe('treeScaleFor', () => {
  it('is clamped and monotonic', () => {
    expect(treeScaleFor(0)).toBeGreaterThanOrEqual(0.65)
    expect(treeScaleFor(1e9)).toBeLessThanOrEqual(1.7)
    expect(treeScaleFor(400)).toBeGreaterThan(treeScaleFor(100))
  })
})

describe('buildForestModel', () => {
  const model = buildForestModel(analysis([snap(0, FILES.slice(0, 3)), snap(1, FILES)]))

  it('creates exactly one tree per union file, standing on the ground', () => {
    expect(model.paths).toHaveLength(FILES.length)
    expect(new Set(model.paths)).toEqual(new Set(FILES.map((f) => f.path)))
    expect(model.positions).toHaveLength(FILES.length * 3)
    for (let i = 0; i < model.paths.length; i++) {
      expect(model.positions[i * 3 + 1]).toBe(0) // y = 0
    }
  })

  it('assigns tree size classes from union (peak) line count', () => {
    const kindOf = (p: string): string => TREE_KINDS[model.kinds[model.indexOf.get(p)!]]
    expect(kindOf('src/index.ts')).toBe('ancient') // 2000 loc
    expect(kindOf('src/app.ts')).toBe('tree') // 400
    expect(kindOf('src/util/b.ts')).toBe('bush') // 60
  })

  it('groups files by their parent directory into groves', () => {
    const grove = (p: string): number => model.groveOf[model.indexOf.get(p)!]
    expect(grove('src/util/a.ts')).toBe(grove('src/util/b.ts'))
    expect(grove('src/util/a.ts')).not.toBe(grove('test/x.test.ts'))
  })

  it('is deterministic', () => {
    const a = buildForestModel(analysis([snap(0, FILES)]))
    const b = buildForestModel(analysis([snap(0, FILES)]))
    expect(a.paths).toEqual(b.paths)
    expect(a.positions).toEqual(b.positions)
    expect(a.kinds).toEqual(b.kinds)
  })
})

describe('forestTargets', () => {
  it('grows present files and zeroes absent ones', () => {
    const model = buildForestModel(analysis([snap(0, FILES.slice(0, 3)), snap(1, FILES)]))
    const early = forestTargets(model, snap(0, FILES.slice(0, 3)), 'language')
    const late = forestTargets(model, snap(1, FILES), 'language')
    const i = model.indexOf.get('README.md')!
    expect(early.scales[i]).toBe(0) // not yet planted → grows in later
    expect(late.scales[i]).toBeGreaterThan(0)
    const j = model.indexOf.get('src/index.ts')!
    expect(early.scales[j]).toBeGreaterThan(0)
    const sum = late.colors[j * 3] + late.colors[j * 3 + 1] + late.colors[j * 3 + 2]
    expect(sum).toBeGreaterThan(0)
  })
})
