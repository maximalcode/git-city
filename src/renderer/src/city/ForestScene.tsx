import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Object3D } from 'three'
import type { ForestModel, ForestTargets } from '../layout/forest'
import { useStore } from '../store'
import { getTheme } from './themes'
import Effects from './Effects'
import SkyDome from './SkyDome'
import Trees from './Trees'

/** Grass tone per theme (trees stand on green ground whatever the sky does). */
const GRASS: Record<string, string> = {
  'realistic-day': '#3f6b30',
  'realistic-night': '#16271a',
  neon: '#122436',
  'golden-hour': '#4a5326',
  'midnight-ink': '#141f18'
}

const dummy = new Object3D()

/**
 * Everything forest-specific inside the Canvas: sky, sun, a grass floor with
 * softly tinted grove clearings (one per folder), and the trees themselves.
 * Reuses the city's git-op effects — the forest sits on the ground just like
 * the city, so pushes/pulls/commits read the same.
 */
export default function ForestScene({
  model,
  targets
}: {
  model: ForestModel
  targets: ForestTargets
}): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))
  const size = model.worldSize
  const grass = GRASS[theme.id] ?? '#2f5227'

  return (
    <group>
      {theme.sky === 'gradient' && (
        <SkyDome top={theme.skyTop} bottom={theme.skyBottom} radius={size * 14} />
      )}

      <hemisphereLight
        args={[theme.hemisphere.sky, grass, theme.hemisphere.intensity + 0.1]}
      />
      <directionalLight
        position={[size * 0.7, size * 1.1, size * 0.4]}
        intensity={theme.dirMain.intensity}
        color={theme.dirMain.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-size}
        shadow-camera-right={size}
        shadow-camera-top={size}
        shadow-camera-bottom={-size}
        shadow-camera-far={size * 4}
        shadow-bias={-0.0004}
      />
      <directionalLight
        position={[-size, size * 0.5, -size * 0.6]}
        intensity={theme.dirFill.intensity}
        color={theme.dirFill.color}
      />

      {/* grass floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[size * 12, size * 12]} />
        <meshStandardMaterial color={grass} roughness={1} />
      </mesh>

      <GrovePatches model={model} grass={grass} />
      <Trees model={model} targets={targets} />
      <Effects citySize={size} />
    </group>
  )
}

/** A flat, softly-tinted clearing under each folder so groves read as groups. */
function GrovePatches({
  model,
  grass
}: {
  model: ForestModel
  grass: string
}): React.JSX.Element | null {
  const patches = useMemo(
    () => model.layout.districts.filter((d) => d.depth <= 2),
    [model]
  )
  const ref = useRef<InstancedMesh>(null!)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const base = new Color(grass)
    const c = new Color()
    for (let i = 0; i < patches.length; i++) {
      const d = patches[i]
      dummy.position.set(d.rect.x + d.rect.w / 2, 0.005 + d.depth * 0.004, d.rect.y + d.rect.h / 2)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(d.rect.w * 0.96, d.rect.h * 0.96, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // alternate a hair lighter / darker than the grass so groves are legible
      const lift = ((i % 3) - 1) * 0.06
      c.copy(base).offsetHSL(0.02, 0.05, lift)
      mesh.setColorAt(i, c)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [patches, grass])

  if (patches.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, patches.length]} receiveShadow>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={1} />
    </instancedMesh>
  )
}
