import type { Snapshot } from '../../../shared/types'
import { useStore } from '../store'
import { getTheme } from './themes'
import type { CityModel, Targets } from './cityData'
import Buildings from './Buildings'
import Districts from './Districts'
import Roads from './Roads'
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
  snapshot
}: {
  model: CityModel
  targets: Targets
  snapshot: Snapshot
}): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))
  const size = model.citySize

  return (
    <group>
      {theme.sky === 'gradient' && (
        <SkyDome top={theme.skyTop} bottom={theme.skyBottom} radius={size * 14} />
      )}

      <hemisphereLight
        args={[theme.hemisphere.sky, theme.hemisphere.ground, theme.hemisphere.intensity]}
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

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[size * 12, size * 12]} />
        <meshStandardMaterial color={theme.ground} roughness={1} />
      </mesh>

      <Districts model={model} />
      <Roads model={model} />
      <Buildings model={model} targets={targets} />
      <Highlight model={model} targets={targets} />
      <StatusOverlay model={model} targets={targets} />
      <ConstructionSites model={model} />
      <Traffic model={model} snapshot={snapshot} />
      <Effects citySize={size} />
    </group>
  )
}
