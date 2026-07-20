/**
 * Squarified treemap (Bruls, Huizing & van Wijk) specialised for city layout:
 * directories become nested "districts", files become building plots.
 * All coordinates are on the XZ ground plane, centered on the origin.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Plot {
  path: string
  rect: Rect
}

export interface District {
  path: string
  name: string
  depth: number
  rect: Rect
}

export interface CityInput {
  path: string
  weight: number
}

/**
 * A street centerline on the XZ plane. `axis` is the direction of travel:
 * 'z' roads run along z at fixed x (vertical shared edges), 'x' roads the reverse.
 * (x, z) is the start of the centerline; `depth` is the recursion depth of the
 * district whose plate the road lies on (0 = city ground).
 */
export interface RoadSegment {
  axis: 'x' | 'z'
  x: number
  z: number
  length: number
  width: number
  depth: number
}

export interface CityLayout {
  plots: Plot[]
  districts: District[]
  roads: RoadSegment[]
}

interface DirNode {
  name: string
  path: string
  weight: number
  dirs: Map<string, DirNode>
  files: { path: string; weight: number }[]
}

function makeDir(name: string, path: string): DirNode {
  return { name, path, weight: 0, dirs: new Map(), files: [] }
}

export function buildTree(files: CityInput[]): DirNode {
  const root = makeDir('', '')
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.dirs.get(name)
      if (!child) {
        child = makeDir(name, node.path ? `${node.path}/${name}` : name)
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push({ path: f.path, weight: Math.max(f.weight, 1) })
  }
  const sum = (n: DirNode): number => {
    n.weight = n.files.reduce((a, f) => a + f.weight, 0)
    for (const d of n.dirs.values()) n.weight += sum(d)
    return n.weight
  }
  sum(root)
  return root
}

interface Item<T> {
  weight: number
  payload: T
}

/**
 * Lay items out inside `rect` using the squarified algorithm.
 * Items should be sorted by descending weight for best aspect ratios.
 */
export function squarify<T>(items: Item<T>[], rect: Rect): { payload: T; rect: Rect }[] {
  const out: { payload: T; rect: Rect }[] = []
  if (items.length === 0 || rect.w <= 0 || rect.h <= 0) return out

  const totalWeight = items.reduce((a, i) => a + i.weight, 0)
  if (totalWeight <= 0) return out
  const scale = (rect.w * rect.h) / totalWeight
  const areas = items.map((i) => ({ payload: i.payload, area: i.weight * scale }))

  let x = rect.x
  let y = rect.y
  let w = rect.w
  let h = rect.h
  let row: { payload: T; area: number }[] = []
  let rowArea = 0

  const worst = (rowArr: { area: number }[], total: number, side: number): number => {
    if (rowArr.length === 0) return Infinity
    let min = Infinity
    let max = 0
    for (const r of rowArr) {
      if (r.area < min) min = r.area
      if (r.area > max) max = r.area
    }
    const s2 = total * total
    const side2 = side * side
    return Math.max((side2 * max) / s2, s2 / (side2 * min))
  }

  const layoutRow = (rowArr: { payload: T; area: number }[], total: number): void => {
    const horizontal = w >= h // lay the row along the shorter side
    const side = horizontal ? h : w
    const thickness = side > 0 ? total / side : 0
    let offset = 0
    for (const r of rowArr) {
      const len = thickness > 0 ? r.area / thickness : 0
      out.push(
        horizontal
          ? { payload: r.payload, rect: { x, y: y + offset, w: thickness, h: len } }
          : { payload: r.payload, rect: { x: x + offset, y, w: len, h: thickness } }
      )
      offset += len
    }
    if (horizontal) {
      x += thickness
      w -= thickness
    } else {
      y += thickness
      h -= thickness
    }
  }

  for (const a of areas) {
    const side = Math.min(w, h)
    if (row.length > 0 && worst([...row, a], rowArea + a.area, side) > worst(row, rowArea, side)) {
      layoutRow(row, rowArea)
      row = []
      rowArea = 0
    }
    row.push(a)
    rowArea += a.area
  }
  if (row.length > 0) layoutRow(row, rowArea)
  return out
}

function effInset(r: Rect, pad: number): number {
  return Math.min(pad, r.w * 0.25, r.h * 0.25)
}

function inset(r: Rect, pad: number): Rect {
  const p = effInset(r, pad)
  return { x: r.x + p, y: r.y + p, w: r.w - 2 * p, h: r.h - 2 * p }
}

/** Fraction of the inset corridor covered by asphalt (the rest reads as sidewalk). */
const ROAD_FILL = 0.85
/** Roads narrower / shorter than this are invisible slivers — skip them. */
const MIN_ROAD_WIDTH = 0.35
const MIN_ROAD_LENGTH = 0.8
const EDGE_EPS = 1e-4

interface ChildBox {
  rect: Rect
  ins: number
}

/**
 * Emit street centerlines between sibling rects. Siblings tile `rect` flush;
 * the visible corridor between two neighbours is the sum of their content
 * insets, centered on the shared edge offset by the inset difference.
 * Segments touching the tiling boundary are extended outward by `outerPad`
 * so they T-junction into the enclosing district's avenue (the road graph
 * snaps and splits these crossings).
 */
function emitRoads(
  kids: ChildBox[],
  rect: Rect,
  depth: number,
  outerPad: number,
  out: RoadSegment[]
): void {
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i]
      const b = kids[j]
      // vertical shared edge (road runs along z)
      let left: ChildBox | null = null
      let right: ChildBox | null = null
      if (Math.abs(a.rect.x + a.rect.w - b.rect.x) < EDGE_EPS) {
        left = a
        right = b
      } else if (Math.abs(b.rect.x + b.rect.w - a.rect.x) < EDGE_EPS) {
        left = b
        right = a
      }
      if (left && right) {
        const width = (left.ins + right.ins) * ROAD_FILL
        let z0 = Math.max(left.rect.y, right.rect.y)
        let z1 = Math.min(left.rect.y + left.rect.h, right.rect.y + right.rect.h)
        if (z1 - z0 > MIN_ROAD_LENGTH && width >= MIN_ROAD_WIDTH) {
          if (z0 - rect.y < EDGE_EPS) z0 -= outerPad
          if (rect.y + rect.h - z1 < EDGE_EPS) z1 += outerPad
          const edge = left.rect.x + left.rect.w
          out.push({
            axis: 'z',
            x: edge + (right.ins - left.ins) / 2,
            z: z0,
            length: z1 - z0,
            width,
            depth
          })
        }
        continue
      }
      // horizontal shared edge (road runs along x)
      let top: ChildBox | null = null
      let bottom: ChildBox | null = null
      if (Math.abs(a.rect.y + a.rect.h - b.rect.y) < EDGE_EPS) {
        top = a
        bottom = b
      } else if (Math.abs(b.rect.y + b.rect.h - a.rect.y) < EDGE_EPS) {
        top = b
        bottom = a
      }
      if (top && bottom) {
        const width = (top.ins + bottom.ins) * ROAD_FILL
        let x0 = Math.max(top.rect.x, bottom.rect.x)
        let x1 = Math.min(top.rect.x + top.rect.w, bottom.rect.x + bottom.rect.w)
        if (x1 - x0 > MIN_ROAD_LENGTH && width >= MIN_ROAD_WIDTH) {
          if (x0 - rect.x < EDGE_EPS) x0 -= outerPad
          if (rect.x + rect.w - x1 < EDGE_EPS) x1 += outerPad
          const edge = top.rect.y + top.rect.h
          out.push({
            axis: 'x',
            x: x0,
            z: edge + (bottom.ins - top.ins) / 2,
            length: x1 - x0,
            width,
            depth
          })
        }
      }
    }
  }
}

/**
 * Compute the full city layout. `size` is the length of the square city's side
 * in world units; padding shrinks with depth to create streets between districts.
 */
export function cityLayout(files: CityInput[], size = 140): CityLayout {
  const root = buildTree(files)
  const plots: Plot[] = []
  const districts: District[] = []
  const roads: RoadSegment[] = []

  const recurse = (node: DirNode, rect: Rect, depth: number, outerPad: number): void => {
    // generous top-level padding: boulevards wide enough for two driving lanes
    // PLUS curb parking (see streetFurniture's clearance math)
    const pad = Math.max(0.5, 3.4 / (depth + 1))
    const items: Item<{ dir?: DirNode; file?: { path: string; weight: number } }>[] = [
      ...Array.from(node.dirs.values(), (d) => ({ weight: d.weight, payload: { dir: d } })),
      ...node.files.map((f) => ({ weight: f.weight, payload: { file: f } }))
    ].sort((a, b) => b.weight - a.weight)

    const kids: ChildBox[] = []
    for (const { payload, rect: r } of squarify(items, rect)) {
      if (payload.dir) {
        districts.push({
          path: payload.dir.path,
          name: payload.dir.name,
          depth: depth + 1,
          rect: r
        })
        kids.push({ rect: r, ins: effInset(r, pad) })
        recurse(payload.dir, inset(r, pad), depth + 1, effInset(r, pad))
      } else if (payload.file) {
        plots.push({ path: payload.file.path, rect: inset(r, pad * 0.55) })
        kids.push({ rect: r, ins: effInset(r, pad * 0.55) })
      }
    }
    emitRoads(kids, rect, depth, outerPad, roads)
  }

  recurse(root, { x: -size / 2, y: -size / 2, w: size, h: size }, 0, 0)
  return { plots, districts, roads }
}
