import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import { useStore } from '../store'
import { getTheme } from './themes'
import { createBuildingMaterial } from './buildingMaterial'
import type { CityModel, Targets } from './cityData'

const dummy = new Object3D()
const colorScratch = new Color()

/** Below this height a building counts as "not there" for interactions. */
const MIN_VISIBLE = 0.05

interface Props {
  model: CityModel
  targets: Targets
}

export default function Buildings({ model, targets }: Props): React.JSX.Element {
  const meshRef = useRef<InstancedMesh>(null!)
  const setHovered = useStore((s) => s.setHovered)
  const setSelected = useStore((s) => s.setSelected)
  const theme = getTheme(useStore((s) => s.themeId))
  const { material, win } = useMemo(() => createBuildingMaterial(), [])

  // passed as a prop (not JSX-created), so R3F won't dispose it for us
  useEffect(() => () => material.dispose(), [material])

  // push theme-driven material + window uniforms
  useEffect(() => {
    material.roughness = theme.building.roughness
    material.metalness = theme.building.metalness
    if (material.flatShading !== theme.lowPoly) {
      material.flatShading = theme.lowPoly
      material.needsUpdate = true
    }
    win.enabled.value = theme.windows.enabled ? 1 : 0
    win.color.value.set(theme.windows.color)
    win.intensity.value = theme.windows.intensity
  }, [material, win, theme])

  const n = model.paths.length
  const anim = useMemo(
    () => ({
      heights: new Float32Array(n), // start at 0 → city "builds in" on load
      colors: new Float32Array(targets.colors),
      settled: false
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model]
  )

  // new targets → resume animating
  useEffect(() => {
    anim.settled = false
  }, [targets, anim])

  useFrame((_, dt) => {
    if (anim.settled) return
    const mesh = meshRef.current
    if (!mesh) return
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * theme.lerpSpeed)
    let maxDelta = 0

    for (let i = 0; i < n; i++) {
      const th = targets.heights[i]
      const ch = anim.heights[i]
      const nh = ch + (th - ch) * k
      anim.heights[i] = nh
      const d = Math.abs(th - nh)
      if (d > maxDelta) maxDelta = d

      const { rect } = model.layout.plots[i]
      const h = Math.max(nh, 0.001)
      dummy.position.set(rect.x + rect.w / 2, h / 2, rect.y + rect.h / 2)
      dummy.scale.set(rect.w, h, rect.h)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      for (let ci = 0; ci < 3; ci++) {
        const idx = i * 3 + ci
        const cc = anim.colors[idx]
        const tc = targets.colors[idx]
        const nc = cc + (tc - cc) * k
        anim.colors[idx] = nc
        const cd = Math.abs(tc - nc)
        if (cd > maxDelta) maxDelta = cd
      }
      mesh.setColorAt(
        i,
        colorScratch.setRGB(anim.colors[i * 3], anim.colors[i * 3 + 1], anim.colors[i * 3 + 2])
      )
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    if (maxDelta < 0.002) anim.settled = true
  })

  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation()
    const id = e.instanceId
    if (id === undefined || anim.heights[id] < MIN_VISIBLE) {
      setHovered(null)
      return
    }
    setHovered(model.paths[id])
  }

  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation()
    const id = e.instanceId
    if (id === undefined || anim.heights[id] < MIN_VISIBLE) return
    setSelected(model.paths[id])
  }

  return (
    <instancedMesh
      key={n} // remount when building count changes (new repo)
      ref={meshRef}
      args={[undefined, undefined, n]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onPointerMove={onMove}
      onPointerOut={() => setHovered(null)}
      onClick={onClick}
      material={material}
    >
      <boxGeometry />
    </instancedMesh>
  )
}
