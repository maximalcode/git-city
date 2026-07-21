import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping
} from 'three'
import type { CityModel } from './cityData'
import { buildRoadGeometry } from './roadGeometry'
import { asphaltTextures, pavingTextures } from './pbrTextures'
import { useStore } from '../store'
import { getTheme } from './themes'

/**
 * Street surfaces: raised paving-stone sidewalks with curbs, photo-real PBR
 * asphalt (bundled CC0 maps, tinted per theme), a dashed-centerline overlay,
 * zebra crosswalks at junctions, and (for neon themes) an additive markings
 * layer the bloom pass picks up. All static, built once per city model.
 */

/** Average luminance of the bundled color maps — the theme's flat surface color
 *  multiplies the map, so dividing by this keeps the street exactly as bright
 *  as the pre-PBR flat-color look. */
const ASPHALT_MAP_LUMA = 0.42
const PAVING_MAP_LUMA = 0.52

function tinted(hex: string, mapLuma: number): Color {
  return new Color(hex).multiplyScalar(1 / mapLuma)
}

export default function Roads({ model }: { model: CityModel }): React.JSX.Element | null {
  const theme = getTheme(useStore((s) => s.themeId))

  const geo = useMemo(() => buildRoadGeometry(model.roadGraph), [model])
  useEffect(
    () => () => {
      geo.asphalt.dispose()
      geo.junction.dispose()
      geo.sidewalk.dispose()
      geo.crosswalk.dispose()
    },
    [geo]
  )

  const asphalt = asphaltTextures()
  const paving = pavingTextures()

  const markingTex = useMemo(
    () => makeMarkingTexture(theme.road.marking, false),
    [theme.road.marking]
  )
  useEffect(() => () => markingTex.dispose(), [markingTex])

  const glowTex = useMemo(
    () => (theme.road.markingEmissive > 0 ? makeMarkingTexture(theme.road.marking, true) : null),
    [theme.road.markingEmissive, theme.road.marking]
  )
  useEffect(() => () => glowTex?.dispose(), [glowTex])

  const asphaltTint = useMemo(() => tinted(theme.road.surface, ASPHALT_MAP_LUMA), [theme])
  const sidewalkTint = useMemo(() => tinted(theme.road.sidewalk, PAVING_MAP_LUMA), [theme])

  if (model.roadGraph.edges.length === 0) return null

  return (
    <group>
      {/* raised paving-stone sidewalks + curb faces (grayscale vertex colours
          shade the curb; DoubleSide so the vertical faces light from both sides) */}
      <mesh geometry={geo.sidewalk} receiveShadow castShadow>
        <meshStandardMaterial
          color={sidewalkTint}
          map={paving.map}
          normalMap={paving.normalMap}
          roughness={0.9}
          metalness={0}
          vertexColors
          side={DoubleSide}
        />
      </mesh>

      {/* asphalt carriageway — real road photogrammetry, tinted per theme */}
      <mesh geometry={geo.asphalt} receiveShadow>
        <meshStandardMaterial
          color={asphaltTint}
          map={asphalt.map}
          normalMap={asphalt.normalMap}
          roughnessMap={asphalt.roughnessMap}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* junction squares — same asphalt, world UVs, no centerline on top */}
      <mesh geometry={geo.junction} receiveShadow>
        <meshStandardMaterial
          color={asphaltTint}
          map={asphalt.map}
          normalMap={asphalt.normalMap}
          roughnessMap={asphalt.roughnessMap}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* dashed centerline overlay (transparent outside the dash band) */}
      <mesh geometry={geo.asphalt} position={[0, 0.005, 0]}>
        <meshStandardMaterial
          map={markingTex}
          transparent
          depthWrite={false}
          roughness={0.7}
          metalness={0}
        />
      </mesh>

      {/* zebra crossings */}
      <mesh geometry={geo.crosswalk}>
        <meshStandardMaterial
          color={theme.road.marking}
          roughness={0.7}
          metalness={0}
          side={DoubleSide}
        />
      </mesh>

      {glowTex && (
        <mesh geometry={geo.asphalt} position={[0, 0.006, 0]}>
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
 * 128×64 canvas holding ONLY the dashed centerline (u = half the dash period).
 * The dash band sits in the middle rows; edge rows stay empty so junction quads
 * (constant UV near the border) and the v-clamp never sample a marking.
 * glowOnly = opaque black background + marking, used additively for neon.
 */
function makeMarkingTexture(marking: string, glowOnly: boolean): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  if (glowOnly) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 128, 64)
  } else {
    ctx.clearRect(0, 0, 128, 64)
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
