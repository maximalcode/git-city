/**
 * Nearest-point queries over a static point set, on the XZ ground plane.
 *
 * The scene needs "which building is this bit of road next to?" for every road
 * edge in the city. Done directly that is a scan of every plot per edge —
 * `O(edges × plots)`, which at the drawn cap (20,000 plots, ~52,000 edges) is
 * about 1.0 × 10⁹ distance computations on the main thread while the user is
 * staring at a progress bar that already said 100% (#12).
 *
 * A uniform grid over the points turns each query into a scan of the cell the
 * query lands in, then of successively wider rings around it, stopping as soon
 * as the nearest unvisited cell cannot beat the best distance found so far.
 * The points are plot centres from a treemap, so they are spread over the city
 * rather than clustered, which is the case a uniform grid is best at.
 *
 * Ties resolve to the lowest index, matching the `d < bestD` scan this replaces
 * — the layout must be reproducible, so query order must not decide the answer.
 */

export interface PointGrid {
  /** x of each point, by index */
  xs: ArrayLike<number>
  /** z of each point, by index */
  zs: ArrayLike<number>
  /** cells across x */
  nx: number
  /** cells across z */
  nz: number
  minX: number
  minZ: number
  /** cell extent in world units */
  cw: number
  ch: number
  /** start offset into `items` for each cell, length nx*nz+1 */
  starts: Int32Array
  /** point indices, grouped by cell */
  items: Int32Array
}

/** Roughly how many points we want to land in one cell. */
const TARGET_PER_CELL = 2
/** Cells per axis, bounded so a degenerate spread cannot allocate wildly. */
const MAX_CELLS_PER_AXIS = 1024

/**
 * Bucket `n` points into a uniform grid sized so cells hold ~2 points each.
 *
 * `xs` and `zs` are parallel and are kept by reference, not copied — the caller
 * owns them for the lifetime of the grid. Both must have the same length.
 */
export function buildPointGrid(xs: ArrayLike<number>, zs: ArrayLike<number>): PointGrid {
  const n = xs.length

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const z = zs[i]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (n === 0) {
    minX = 0
    maxX = 0
    minZ = 0
    maxZ = 0
  }

  // A zero-width or zero-height spread (every point collinear, or one point)
  // still needs a positive cell size, or the index arithmetic divides by zero.
  const spanX = maxX - minX || 1
  const spanZ = maxZ - minZ || 1

  const targetCells = Math.max(1, Math.ceil(n / TARGET_PER_CELL))
  const aspect = spanX / spanZ
  const nx = clampAxis(Math.round(Math.sqrt(targetCells * aspect)))
  const nz = clampAxis(Math.ceil(targetCells / nx))

  const cw = spanX / nx
  const ch = spanZ / nz

  // Counting sort into cells: one pass to count, one to place.
  const starts = new Int32Array(nx * nz + 1)
  const cellOf = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const cx = cellIndex(xs[i], minX, cw, nx)
    const cz = cellIndex(zs[i], minZ, ch, nz)
    const c = cz * nx + cx
    cellOf[i] = c
    starts[c + 1]++
  }
  for (let c = 0; c < nx * nz; c++) starts[c + 1] += starts[c]

  const items = new Int32Array(n)
  const cursor = Int32Array.from(starts.subarray(0, nx * nz))
  for (let i = 0; i < n; i++) items[cursor[cellOf[i]]++] = i

  return { xs, zs, nx, nz, minX, minZ, cw, ch, starts, items }
}

/**
 * Index of the point nearest to (x, z), or 0 when the grid holds no points.
 *
 * Returning 0 for the empty grid matches the scan this replaces, which left its
 * `best` at its initial 0 when there was nothing to compare against.
 */
export function nearest(grid: PointGrid, x: number, z: number): number {
  const { xs, zs, nx, nz, minX, minZ, cw, ch, starts, items } = grid
  if (items.length === 0) return 0

  const cx = cellIndex(x, minX, cw, nx)
  const cz = cellIndex(z, minZ, ch, nz)

  let best = 0
  let bestD = Infinity

  const maxRing = Math.max(cx, nx - 1 - cx, cz, nz - 1 - cz)
  for (let r = 0; r <= maxRing; r++) {
    const x0 = cx - r
    const x1 = cx + r
    const z0 = cz - r
    const z1 = cz + r

    for (let gz = Math.max(0, z0); gz <= Math.min(nz - 1, z1); gz++) {
      // Ring r is the border of the block, so interior rows contribute only
      // their two end columns; the first and last rows contribute all of theirs.
      const edgeRow = gz === z0 || gz === z1
      const from = Math.max(0, x0)
      const to = Math.min(nx - 1, x1)
      for (let gx = from; gx <= to; gx++) {
        if (!edgeRow && gx !== x0 && gx !== x1) continue
        const c = gz * nx + gx
        for (let k = starts[c]; k < starts[c + 1]; k++) {
          const pi = items[k]
          const dx = xs[pi] - x
          const dz = zs[pi] - z
          const d = dx * dx + dz * dz
          if (d < bestD || (d === bestD && pi < best)) {
            bestD = d
            best = pi
          }
        }
      }
    }

    // Everything not yet visited lies outside the block of rings 0..r, so if
    // the gap to that block's boundary already beats the best hit, we are done.
    if (bestD < Infinity) {
      const gap = blockGap(x, z, x0, x1, z0, z1, minX, minZ, cw, ch)
      if (gap * gap > bestD) break
    }
  }

  return best
}

function clampAxis(v: number): number {
  if (!Number.isFinite(v) || v < 1) return 1
  return Math.min(MAX_CELLS_PER_AXIS, Math.trunc(v))
}

function cellIndex(v: number, min: number, size: number, count: number): number {
  const i = Math.floor((v - min) / size)
  if (i < 0) return 0
  if (i > count - 1) return count - 1
  return i
}

/**
 * Shortest distance from (x, z) to anywhere outside the cell block
 * [x0..x1] × [z0..z1]. Zero when the point sits on or past a boundary, which
 * makes the caller's early-exit test conservative rather than wrong.
 */
function blockGap(
  x: number,
  z: number,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  minX: number,
  minZ: number,
  cw: number,
  ch: number
): number {
  const loX = minX + x0 * cw
  const hiX = minX + (x1 + 1) * cw
  const loZ = minZ + z0 * ch
  const hiZ = minZ + (z1 + 1) * ch
  return Math.max(0, Math.min(x - loX, hiX - x, z - loZ, hiZ - z))
}
