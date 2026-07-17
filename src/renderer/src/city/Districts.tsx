import { useLayoutEffect, useMemo, useRef } from 'react'
import { CanvasTexture, Color, InstancedMesh, LinearFilter, Object3D } from 'three'
import type { CityModel } from './cityData'
import { useStore } from '../store'
import { getTheme } from './themes'

const dummy = new Object3D()

/** Stacked ground plates for each directory, one instanced mesh for all. */
export default function Districts({ model }: { model: CityModel }): React.JSX.Element {
  const meshRef = useRef<InstancedMesh>(null!)
  const theme = getTheme(useStore((s) => s.themeId))
  const districts = model.layout.districts
  const n = districts.length

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const base = new Color(theme.districtBase)
    const scratch = new Color()
    for (let i = 0; i < n; i++) {
      const d = districts[i]
      const y = d.depth * 0.09
      dummy.position.set(d.rect.x + d.rect.w / 2, y, d.rect.y + d.rect.h / 2)
      dummy.scale.set(d.rect.w, 0.12, d.rect.h)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // subtly lighter with depth so nesting reads at a glance
      scratch.copy(base).offsetHSL(0, 0, Math.min(d.depth * 0.018, 0.09))
      mesh.setColorAt(i, scratch)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [districts, n, theme.districtBase])

  return (
    <group>
      <instancedMesh key={n} ref={meshRef} args={[undefined, undefined, n]} receiveShadow>
        <boxGeometry />
        <meshStandardMaterial roughness={0.9} metalness={0} />
      </instancedMesh>
      {districts
        .filter((d) => d.depth === 1 && Math.min(d.rect.w, d.rect.h) > model.citySize * 0.06)
        .map((d) => (
          <DistrictLabel
            key={d.path}
            name={d.name}
            x={d.rect.x + d.rect.w / 2}
            z={d.rect.y + 1.4}
            width={d.rect.w}
            labelColor={theme.label}
          />
        ))}
    </group>
  )
}

/** Flat text label drawn onto a canvas texture (no external font loading). */
function DistrictLabel({
  name,
  x,
  z,
  width,
  labelColor
}: {
  name: string
  x: number
  z: number
  width: number
  labelColor: string
}): React.JSX.Element {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const font = '600 64px "Segoe UI", system-ui, sans-serif'
    ctx.font = font
    const tw = Math.ceil(ctx.measureText(name).width) + 24
    canvas.width = Math.max(2, tw)
    canvas.height = 88
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.fillStyle = labelColor
    ctx.fillText(name, 12, 46)
    const tex = new CanvasTexture(canvas)
    tex.minFilter = LinearFilter
    return { texture: tex, aspect: canvas.width / canvas.height }
  }, [name, labelColor])

  const w = Math.min(width * 0.7, aspect * 2.2)
  const h = w / aspect

  return (
    <mesh position={[x, 0.35, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}
