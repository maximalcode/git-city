import { useCallback, useMemo } from 'react'
import type { Snapshot } from '../../../shared/types'
import type { FarmModel, FarmTargets } from '../layout/farm'
import { useStore } from '../store'
import { UNLIT_WORLD_FLOOR, getTheme, lightBoost } from './themes'
import { sunState } from '../lib/daylight'
import { timeOfDayFromCommit } from '../lib/daytime'
import Effects from './Effects'
import SkyDome from './SkyDome'
import Fields from './Fields'
import Farmstead from './Farmstead'
import Livestock from './Livestock'
import Hotspots from './Hotspots'
import Highlight from './Highlight'
import StatusOverlay from './StatusOverlay'
import ConstructionSites from './ConstructionSites'

/** Shortest a hover/select/status box may be drawn over a field. */
const MARKER_FLOOR = 1.2

/**
 * Everything farm-specific inside the Canvas: sky, sun, pasture underfoot, the
 * cultivated fields, the built farm (barns, silos, wind pumps, fencing) and the
 * livestock working their way around it.
 *
 * Reuses the city's git-op effects — the farm sits on the ground just like the
 * city, so pushes/pulls/commits read the same.
 */
export default function FarmScene({
  model,
  targets,
  snapshot,
  hotspots = [],
  reviewPaths = []
}: {
  model: FarmModel
  targets: FarmTargets
  snapshot: Snapshot
  hotspots?: string[]
  reviewPaths?: string[]
}): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))
  const manualTimeOfDay = useStore((s) => s.timeOfDay)
  const sunFollowsCommit = useStore((s) => s.sunFollowsCommit)
  const size = model.worldSize
  const timeOfDay = sunFollowsCommit ? timeOfDayFromCommit(snapshot.date) : manualTimeOfDay
  const sun = sunState(timeOfDay, size)
  // nothing out here glows on its own the way a lit window does — see themes.ts
  const lit = lightBoost(theme, UNLIT_WORLD_FLOOR)

  // beacons float just above the standing crop of the named fields
  const anchorsFor = useCallback(
    (paths: string[]): [number, number, number][] => {
      const out: [number, number, number][] = []
      for (const p of paths) {
        const i = model.indexOf.get(p)
        if (i === undefined) continue
        if (targets.heights[i] <= 0) continue
        out.push([model.centers[i * 2], targets.heights[i] + 1.6, model.centers[i * 2 + 1]])
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
          theme.grass,
          (theme.hemisphere.intensity * lit + 0.1) * sun.ambientFactor
        ]}
      />
      <directionalLight
        position={sun.position}
        intensity={theme.dirMain.intensity * lit * sun.keyFactor}
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
        intensity={theme.dirFill.intensity * lit}
        color={theme.dirFill.color}
      />

      {/* pasture stretching past the fields, so the holding has no visible edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[size * 12, size * 12]} />
        <meshStandardMaterial color={theme.grass} roughness={1} />
      </mesh>

      <Fields model={model} targets={targets} theme={theme} />
      <Farmstead model={model} />
      <Livestock model={model} />
      {/* crop stands a fraction of a building's height, so both marker layers
          get a floor — otherwise a selected field is a bright smear on the soil
          rather than a box you can see from the default camera */}
      <Highlight model={model} targets={targets} floor={MARKER_FLOOR} />
      <StatusOverlay model={model} targets={targets} floor={MARKER_FLOOR} />
      <ConstructionSites model={model} size={size} />
      <Hotspots anchors={beacons} />
      <Hotspots anchors={reviewBeacons} color="#6ec8ff" />
      <Effects citySize={size} />
    </group>
  )
}
