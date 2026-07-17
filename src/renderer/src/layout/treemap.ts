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

export interface CityLayout {
  plots: Plot[]
  districts: District[]
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

function inset(r: Rect, pad: number): Rect {
  const p = Math.min(pad, r.w * 0.25, r.h * 0.25)
  return { x: r.x + p, y: r.y + p, w: r.w - 2 * p, h: r.h - 2 * p }
}

/**
 * Compute the full city layout. `size` is the length of the square city's side
 * in world units; padding shrinks with depth to create streets between districts.
 */
export function cityLayout(files: CityInput[], size = 140): CityLayout {
  const root = buildTree(files)
  const plots: Plot[] = []
  const districts: District[] = []

  const recurse = (node: DirNode, rect: Rect, depth: number): void => {
    const pad = Math.max(0.5, 2.6 / (depth + 1))
    const items: Item<{ dir?: DirNode; file?: { path: string; weight: number } }>[] = [
      ...Array.from(node.dirs.values(), (d) => ({ weight: d.weight, payload: { dir: d } })),
      ...node.files.map((f) => ({ weight: f.weight, payload: { file: f } }))
    ].sort((a, b) => b.weight - a.weight)

    for (const { payload, rect: r } of squarify(items, rect)) {
      if (payload.dir) {
        districts.push({
          path: payload.dir.path,
          name: payload.dir.name,
          depth: depth + 1,
          rect: r
        })
        recurse(payload.dir, inset(r, pad), depth + 1)
      } else if (payload.file) {
        plots.push({ path: payload.file.path, rect: inset(r, pad * 0.55) })
      }
    }
  }

  recurse(root, { x: -size / 2, y: -size / 2, w: size, h: size }, 0)
  return { plots, districts }
}
