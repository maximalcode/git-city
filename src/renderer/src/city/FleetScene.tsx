import type { FleetModel, FleetTargets } from '../layout/fleet'
import { useStore } from '../store'
import { getTheme } from './themes'
import Effects from './Effects'
import { FleetArrivals, FleetHighlight, FleetStatusOverlay } from './FleetOverlays'
import Ships from './Ships'
import SkyDome from './SkyDome'
import Starfield from './Starfield'

/**
 * Everything fleet-specific inside the Canvas: deep-space lighting, starfield,
 * the ship formations and the git-op effects (portal jumps, warp-ins,
 * regroup pulses).
 */
export default function FleetScene({
  model,
  targets
}: {
  model: FleetModel
  targets: FleetTargets
}): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))
  const size = model.worldSize

  return (
    <group>
      {/* deep space: the theme's sky colors darkened toward black */}
      <SkyDome top="#01020a" bottom={theme.skyTop} radius={size * 14} />
      <Starfield worldSize={size} />

      {/* dim ambient + one key light; no shadows (nothing to catch them) */}
      <hemisphereLight args={[theme.hemisphere.sky, '#000005', 0.3]} />
      <directionalLight
        position={[size * 0.7, size * 1.2, size * 0.3]}
        intensity={theme.dirMain.intensity * 0.8}
        color={theme.dirMain.color}
      />
      <directionalLight
        position={[-size, size * 0.2, -size * 0.6]}
        intensity={theme.dirFill.intensity * 0.7}
        color={theme.dirFill.color}
      />

      <Ships model={model} targets={targets} />
      <FleetHighlight model={model} targets={targets} />
      <FleetStatusOverlay model={model} targets={targets} />
      <FleetArrivals model={model} />
      <Effects citySize={size} mode="fleet" />
    </group>
  )
}
