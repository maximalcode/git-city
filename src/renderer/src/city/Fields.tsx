import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import { CROP_KINDS, type FarmModel, type FarmTargets } from '../layout/farm'
import { cropGeometry } from './farmShapes'
import type { Theme } from './themes'

const dummy = new Object3D()
const scratch = new Color()
const soil = new Color()

/**
 * The crop itself: one tilled plot per file, planted in rows.
 *
 * The plot is earth tinted toward the colour-mode hue; the crop standing on it
 * carries that hue properly, and its height carries the live line count. Rows
 * matter more than they sound — scattered tufts read as a weedy patch, while
 * even spacing along one axis is what makes a rectangle read as *cultivated*.
 *
 * Row spacing is uniform across the farm and widened if the whole holding would
 * blow the instance budget, so a monorepo thins out evenly instead of some
 * fields being lush and others bald (see #12).
 */
const TUFT_BUDGET = 26_000
const BASE_SPACING = 0.62
// generous: the global budget is what actually governs density, and a low per
// field cap starves big fields while small ones stay lush — which reads as
// neglect rather than as scale
const MAX_PER_FIELD = 400

/**
 * Row spacing per crop class, relative to BASE_SPACING. A fruit tree's canopy is
 * roughly three times the width of a cereal stook, so planting all three on one
 * pitch packs orchards into a solid mass of blobs — they need room to read as
 * individual trees, and vegetables can sit closer than cereal.
 */
const SPACING_BY_KIND = [0.78, 1, 2.5]

interface Tufts {
  field: Int32Array
  ox: Float32Array
  oz: Float32Array
  count: number
  /** tuft indices grouped by their field's crop class */
  byKind: number[][]
  /** how wide each tuft is drawn, so crops close ranks at any spacing */
  scale: number
}

function plantRows(model: FarmModel, spacing: number): Tufts {
  const n = model.paths.length
  const field: number[] = []
  const ox: number[] = []
  const oz: number[] = []
  for (let i = 0; i < n; i++) {
    const r = model.rects[i]
    // plant along the long axis, so rows follow the shape of the field
    const alongX = r.w >= r.h
    const major = (alongX ? r.w : r.h) * 0.86
    const minor = (alongX ? r.h : r.w) * 0.86
    const pitch = spacing * (SPACING_BY_KIND[model.kinds[i]] ?? 1)
    let rows = Math.max(1, Math.round(minor / pitch))
    let perRow = Math.max(1, Math.round(major / pitch))
    // keep any single field from hogging the budget
    while (rows * perRow > MAX_PER_FIELD && (rows > 1 || perRow > 1)) {
      if (perRow >= rows) perRow--
      else rows--
    }
    for (let a = 0; a < rows; a++) {
      for (let b = 0; b < perRow; b++) {
        // centre each row/column in its own band rather than on the edge
        const u = ((b + 0.5) / perRow - 0.5) * major
        const v = ((a + 0.5) / rows - 0.5) * minor
        // a slight stagger keeps it from looking like graph paper
        const jitter = (a % 2) * (major / perRow) * 0.25
        field.push(i)
        ox.push(alongX ? u + jitter : v)
        oz.push(alongX ? v : u + jitter)
      }
    }
  }
  const byKind: number[][] = CROP_KINDS.map(() => [])
  for (let t = 0; t < field.length; t++) byKind[model.kinds[field[t]]].push(t)
  return {
    field: Int32Array.from(field),
    ox: Float32Array.from(ox),
    oz: Float32Array.from(oz),
    count: field.length,
    byKind,
    scale: spacing / BASE_SPACING
  }
}

export default function Fields({
  model,
  targets,
  theme
}: {
  model: FarmModel
  targets: FarmTargets
  theme: Theme
}): React.JSX.Element {
  const plotRef = useRef<InstancedMesh>(null!)
  // one mesh per crop class, so a field's size changes what grows on it rather
  // than only how tall the same crop stands
  const cropRefs = useRef<(InstancedMesh | null)[]>([])
  const n = model.paths.length

  // Planted once per model: the rows never move, only the crop height changes.
  const tufts = useMemo(() => {
    // Widen the drills until the whole farm fits, fattening each tuft to match.
    // Every field keeps at least one tuft, so a repo with more files than the
    // budget can never fit however wide the drills get — stop as soon as a
    // wider pitch buys nothing rather than spinning on it.
    let spacing = BASE_SPACING
    let planted = plantRows(model, spacing)
    for (let pass = 0; planted.count > TUFT_BUDGET && pass < 4; pass++) {
      spacing *= Math.sqrt(planted.count / TUFT_BUDGET)
      const wider = plantRows(model, spacing)
      if (wider.count >= planted.count) break
      planted = wider
    }
    return planted
  }, [model])

  // live crop heights, eased toward the snapshot's targets
  const heights = useRef(new Float32Array(n))
  useMemo(() => {
    heights.current = new Float32Array(n)
  }, [n])

  // plots are static: place them once per model
  useLayoutEffect(() => {
    const mesh = plotRef.current
    if (!mesh) return
    for (let i = 0; i < n; i++) {
      const r = model.rects[i]
      dummy.position.set(r.x + r.w / 2, 0.012, r.y + r.h / 2)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(r.w * 0.92, r.h * 0.92, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [model, n])

  useFrame((_state, dt) => {
    const plots = plotRef.current
    if (!plots) return
    const k = 1 - Math.exp(-theme.lerpSpeed * Math.min(dt, 0.05))
    soil.set(theme.soil)

    const h = heights.current
    for (let i = 0; i < n; i++) {
      h[i] += (targets.heights[i] - h[i]) * k
      // the plot stays earth — only tinted by what is growing on it, so the
      // farm reads as soil and crop rather than as a colour-swatch quilt
      scratch.setRGB(targets.colors[i * 3], targets.colors[i * 3 + 1], targets.colors[i * 3 + 2])
      plots.setColorAt(i, scratch.lerp(soil, 0.68))
    }
    if (plots.instanceColor) plots.instanceColor.needsUpdate = true

    // `ci`, not `k` — `k` above is the easing factor, and shadowing it here
    // would silently hand a crop index to anything that later needs to ease
    for (let ci = 0; ci < CROP_KINDS.length; ci++) {
      const crops = cropRefs.current[ci]
      const list = tufts.byKind[ci]
      if (!crops || list.length === 0) continue
      for (let m = 0; m < list.length; m++) {
        const t = list[m]
        const i = tufts.field[t]
        const grown = h[i]
        dummy.position.set(
          model.centers[i * 2] + tufts.ox[t],
          0,
          model.centers[i * 2 + 1] + tufts.oz[t]
        )
        // nothing standing on a field whose file does not exist yet
        const w = grown <= 0.02 ? 0 : tufts.scale
        dummy.scale.set(w, grown, w)
        dummy.rotation.set(0, (i * 7 + t) * 0.9, 0)
        dummy.updateMatrix()
        crops.setMatrixAt(m, dummy.matrix)
        scratch
          .setRGB(targets.colors[i * 3], targets.colors[i * 3 + 1], targets.colors[i * 3 + 2])
          .offsetHSL(0, 0.05, ((t % 3) - 1) * 0.035)
        crops.setColorAt(m, scratch)
      }
      crops.instanceMatrix.needsUpdate = true
      if (crops.instanceColor) crops.instanceColor.needsUpdate = true
    }
  })

  const cropGeos = useMemo(() => CROP_KINDS.map((k) => cropGeometry(k)), [])
  useLayoutEffect(() => () => cropGeos.forEach((g) => g.dispose()), [cropGeos])

  return (
    <group>
      <instancedMesh ref={plotRef} args={[undefined, undefined, Math.max(1, n)]} receiveShadow>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      {CROP_KINDS.map((kind, k) =>
        tufts.byKind[k].length === 0 ? null : (
          <instancedMesh
            key={kind}
            ref={(m) => {
              cropRefs.current[k] = m
            }}
            args={[cropGeos[k], undefined, tufts.byKind[k].length]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial roughness={0.85} />
          </instancedMesh>
        )
      )}
    </group>
  )
}
