import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping
} from 'three'
import type { CityModel } from './cityData'
import { buildRoadGeometry } from './roadGeometry'
import { useStore } from '../store'
import { getTheme } from './themes'

/**
 * Street surfaces: one merged static mesh for all roads, plus (for themes with
 * markingEmissive) a second additive markings-only mesh that the bloom pass
 * picks up. Texture u repeats per dash cycle, v is clamped across the width.
 */
export default function Roads({ model }: { model: CityModel }): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))

  const geometry = useMemo(() => buildRoadGeometry(model.roadGraph), [model])
  useEffect(() => () => geometry.dispose(), [geometry])

  const surfaceTex = useMemo(
    () => makeRoadTexture(theme.road.surface, theme.road.marking, false),
    [theme.road.surface, theme.road.marking]
  )
  useEffect(() => () => surfaceTex.dispose(), [surfaceTex])

  const glowTex = useMemo(
    () =>
      theme.road.markingEmissive > 0 ? makeRoadTexture('#000000', theme.road.marking, true) : null,
    [theme.road.markingEmissive, theme.road.marking]
  )
  useEffect(() => () => glowTex?.dispose(), [glowTex])

  if (model.roadGraph.edges.length === 0) return null

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial map={surfaceTex} roughness={0.95} metalness={0} />
      </mesh>
      {glowTex && (
        <mesh geometry={geometry} position={[0, 0.006, 0]}>
          <meshBasicMaterial
            map={glowTex}
            blending={AdditiveBlending}
            transparent
            depthWrite={false}
            toneMapped={false}
            opacity={Math.min(1, theme.road.markingEmissive / 2)}
          />
        </mesh>
      )}
    </group>
  )
}

/**
 * 128×64 canvas: asphalt fill with a dashed centerline along u. The dash band
 * sits in the middle rows; edge rows stay plain so junction quads (constant UV
 * near the border) and the v-clamp never sample a marking.
 * glowOnly = black background + marking (used additively for neon streets).
 */
function makeRoadTexture(surface: string, marking: string, glowOnly: boolean): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = glowOnly ? '#000000' : surface
  ctx.fillRect(0, 0, 128, 64)
  if (!glowOnly) {
    // faint asphalt speckle so large surfaces don't read perfectly flat
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    for (let i = 0; i < 40; i++) {
      // deterministic scatter (no Math.random: identical texture every build)
      const x = (i * 37) % 128
      const y = (i * 53) % 64
      ctx.fillRect(x, y, 2, 2)
    }
  }
  ctx.fillStyle = marking
  ctx.fillRect(0, 29, 64, 6) // dash: half the u-period, centered in v
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.anisotropy = 4
  return tex
}
