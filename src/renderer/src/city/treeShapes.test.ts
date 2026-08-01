import { describe, expect, it } from 'vitest'
import { foliageGeometry, trunkGeometry, type TreeKind } from './treeShapes'

/** Tallest point of a canopy, read off the geometry rather than a helper. */
function canopyTop(kind: TreeKind): number {
  const p = foliageGeometry(kind).getAttribute('position')
  let max = -Infinity
  for (let i = 0; i < p.count; i++) max = Math.max(max, p.getY(i))
  return max
}

describe('tree geometry', () => {
  it('builds valid trunk + foliage for every kind, canopy above the trunk', () => {
    for (const kind of ['bush', 'tree', 'ancient'] as TreeKind[]) {
      const trunk = trunkGeometry(kind)
      const foliage = foliageGeometry(kind)
      expect(trunk.getAttribute('position').count).toBeGreaterThan(0)
      expect(foliage.getAttribute('position').count).toBeGreaterThan(0)
      // trunk base sits at/above the origin, canopy reaches higher
      const tp = trunk.getAttribute('position')
      let trunkMinY = Infinity
      for (let i = 0; i < tp.count; i++) trunkMinY = Math.min(trunkMinY, tp.getY(i))
      expect(trunkMinY).toBeGreaterThanOrEqual(-1e-6)
      expect(canopyTop(kind)).toBeGreaterThan(0.5)
    }
  })

  it('caches geometry per kind (shared instances, never disposed by callers)', () => {
    expect(trunkGeometry('tree')).toBe(trunkGeometry('tree'))
    expect(foliageGeometry('ancient')).toBe(foliageGeometry('ancient'))
  })

  it('canopy gets bigger from bush to ancient', () => {
    expect(canopyTop('ancient')).toBeGreaterThan(canopyTop('tree'))
    expect(canopyTop('tree')).toBeGreaterThan(canopyTop('bush'))
  })
})
