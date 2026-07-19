import { describe, expect, it } from 'vitest'
import {
  foliageGeometry,
  TREE_KINDS,
  treeHeight,
  treeKindFor,
  trunkGeometry
} from './treeShapes'

describe('treeKindFor', () => {
  it('grows the tree class with the line count', () => {
    expect(treeKindFor(10)).toBe('bush')
    expect(treeKindFor(119)).toBe('bush')
    expect(treeKindFor(120)).toBe('tree')
    expect(treeKindFor(799)).toBe('tree')
    expect(treeKindFor(800)).toBe('ancient')
  })
})

describe('tree geometry', () => {
  it('builds valid trunk + foliage for every kind, canopy above the trunk', () => {
    for (const kind of TREE_KINDS) {
      const trunk = trunkGeometry(kind)
      const foliage = foliageGeometry(kind)
      expect(trunk.getAttribute('position').count).toBeGreaterThan(0)
      expect(foliage.getAttribute('position').count).toBeGreaterThan(0)
      // trunk base sits at/above the origin, canopy reaches higher
      const tp = trunk.getAttribute('position')
      let trunkMinY = Infinity
      for (let i = 0; i < tp.count; i++) trunkMinY = Math.min(trunkMinY, tp.getY(i))
      expect(trunkMinY).toBeGreaterThanOrEqual(-1e-6)
      expect(treeHeight(kind)).toBeGreaterThan(0.5)
    }
  })

  it('caches geometry per kind (shared instances, never disposed by callers)', () => {
    expect(trunkGeometry('tree')).toBe(trunkGeometry('tree'))
    expect(foliageGeometry('ancient')).toBe(foliageGeometry('ancient'))
  })

  it('canopy gets bigger from bush to ancient', () => {
    expect(treeHeight('ancient')).toBeGreaterThan(treeHeight('tree'))
    expect(treeHeight('tree')).toBeGreaterThan(treeHeight('bush'))
  })
})
