import { useCallback, useMemo } from 'react'
import type { Snapshot } from '../../../shared/types'
import { useStore } from '../store'
import { getTheme } from './themes'
import { sunState } from '../lib/daylight'
import type { CityModel, Targets } from './cityData'
import Buildings from './Buildings'
import RoofClutter from './RoofClutter'
import Hotspots from './Hotspots'
import Districts from './Districts'
import Roads from './Roads'
import StreetLife from './StreetLife'
import Highlight from './Highlight'
import StatusOverlay from './StatusOverlay'
import ConstructionSites from './ConstructionSites'
import Effects from './Effects'
import SkyDome from './SkyDome'
import Traffic from './Traffic'

/** Everything city-specific inside the Canvas: lights, ground, districts,
 *  streets, buildings, traffic and the git-op effects. */
export default function CityScene({
  model,
  targets,
  snapshot,
  hotspots = [],
  reviewPaths = []
}: {
  model: CityModel
  targets: Targets
  snapshot: Snapshot
  hotspots?: string[]
  reviewPaths?: string[]
}): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))
  const timeOfDay = useStore((s) => s.timeOfDay)
  const size = model.citySize
  const sun = sunState(timeOfDay, size)

  // beacon anchors at a set of files' rooftops (shared by hotspots + PR review)
  const anchorsFor = useCallback(
    (paths: string[]): [number, number, number][] => {
      const out: [number, number, number][] = []
      for (const p of paths) {
        const i = model.indexOf.get(p)
        if (i === undefined) continue
        const h = targets.heights[i]
        if (h <= 0) continue
        const { rect } = model.layout.plots[i]
        out.push([rect.x + rect.w / 2, h, rect.y + rect.h / 2])
      }
      return out
    },
    [model, targets]
  )
  const beacons = useMemo(() => anchorsFor(hotspots), [anchorsFor, hotspots])
  const reviewBeacons = useMemo(() => anchorsFor(reviewPaths), [anchorsFor, reviewPaths])

  return (
    <group>
      {theme.sky === 'gradient' && (
        <SkyDome top={theme.skyTop} bottom={theme.skyBottom} radius={size * 14} />
      )}

      <hemisphereLight
        args={[
          theme.hemisphere.sky,
          theme.hemisphere.ground,
          theme.hemisphere.intensity * sun.ambientFactor
        ]}
      />
      <directionalLight
        position={sun.position}
        intensity={theme.dirMain.intensity * sun.keyFactor}
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

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[size * 12, size * 12]} />
        <meshStandardMaterial color={theme.ground} roughness={1} />
      </mesh>

      <Districts model={model} />
      <Roads model={model} />
      <StreetLife model={model} />
      <Buildings model={model} targets={targets} />
      <RoofClutter model={model} targets={targets} />
      <Highlight model={model} targets={targets} />
      <StatusOverlay model={model} targets={targets} />
      <ConstructionSites model={model} />
      <Traffic model={model} snapshot={snapshot} />
      <Hotspots anchors={beacons} />
      <Hotspots anchors={reviewBeacons} color="#6ec8ff" />
      <Effects citySize={size} />
    </group>
  )
}
