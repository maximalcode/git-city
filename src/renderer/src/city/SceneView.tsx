import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import { Vector3 } from 'three'
import CameraRig from './CameraRig'
import SceneBoundary from '../lib/SceneBoundary'
import { useStore } from '../store'
import { playStepMs } from '../lib/playback'
import { getTheme } from './themes'
import { buildCityModel, snapshotTargets, type CityModel } from './cityData'
import { buildFleetModel, fleetTargets, type FleetModel } from '../layout/fleet'
import type { RepoAnalysis } from '../../../shared/types'
import CityScene from './CityScene'
import FleetScene from './FleetScene'
import Hud from './Hud'
import ChangesPanel from '../panels/ChangesPanel'
import BranchesPanel from '../panels/BranchesPanel'
import StashPanel from '../panels/StashPanel'
import MergeView from '../panels/MergeView'
import DiffPanel from '../panels/DiffPanel'
import FileHistoryPanel from '../panels/FileHistoryPanel'
import CommitGraphPanel from '../panels/CommitGraphPanel'
import RebasePanel from '../panels/RebasePanel'
import ReflogPanel from '../panels/ReflogPanel'

// Per-analysis model caches: toggling the view mode back and forth must not
// re-run the layout algorithms.
const cityCache = new WeakMap<RepoAnalysis, CityModel>()
const fleetCache = new WeakMap<RepoAnalysis, FleetModel>()

function getCityModel(analysis: RepoAnalysis): CityModel {
  let m = cityCache.get(analysis)
  if (!m) {
    m = buildCityModel(analysis)
    cityCache.set(analysis, m)
  }
  return m
}

function getFleetModel(analysis: RepoAnalysis): FleetModel {
  let m = fleetCache.get(analysis)
  if (!m) {
    m = buildFleetModel(analysis)
    fleetCache.set(analysis, m)
  }
  return m
}

/**
 * Mode-agnostic scene shell: owns the Canvas, fog, playback ticker, camera
 * rig, postprocessing, HUD and panels. The view-mode-specific world (city or
 * fleet) mounts as a subtree.
 */
export default function SceneView(): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)!
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const colorMode = useStore((s) => s.colorMode)
  const themeId = useStore((s) => s.themeId)
  const theme = getTheme(themeId)
  const playing = useStore((s) => s.playing)
  const viewMode = useStore((s) => s.viewMode)

  const snapshot = analysis.snapshots[Math.min(snapshotIndex, analysis.snapshots.length - 1)]

  // only the active mode's model is built (lazily, cached per analysis)
  const cityModel = viewMode === 'city' ? getCityModel(analysis) : null
  const fleetModel = viewMode === 'fleet' ? getFleetModel(analysis) : null

  const cityTargets = useMemo(
    () => (cityModel ? snapshotTargets(cityModel, snapshot, colorMode) : null),
    [cityModel, snapshot, colorMode]
  )
  const fleetTgt = useMemo(
    () => (fleetModel ? fleetTargets(fleetModel, snapshot, colorMode) : null),
    [fleetModel, snapshot, colorMode]
  )

  const snapshotCount = analysis.snapshots.length
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const s = useStore.getState()
      if (!s.analysis || s.snapshotIndex >= s.analysis.snapshots.length - 1) {
        useStore.setState({ playing: false })
      } else {
        useStore.setState({ snapshotIndex: s.snapshotIndex + 1 })
      }
    }, playStepMs(snapshotCount))
    return () => clearInterval(id)
  }, [playing, snapshotCount])

  const size = cityModel ? cityModel.citySize : fleetModel!.worldSize
  const bg = viewMode === 'fleet' ? '#02030a' : theme.background
  const useAO = theme.ao && viewMode === 'city'

  // fly-to target: building plot center in the city, ship position in the fleet
  const resolveFocus = useMemo(
    () =>
      (path: string): Vector3 | null => {
        if (cityModel) {
          const i = cityModel.indexOf.get(path)
          if (i === undefined) return null
          const { rect } = cityModel.layout.plots[i]
          return new Vector3(rect.x + rect.w / 2, 5, rect.y + rect.h / 2)
        }
        const m = fleetModel!
        const i = m.indexOf.get(path)
        if (i === undefined) return null
        return new Vector3(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2])
      },
    [cityModel, fleetModel]
  )

  const hudModel = cityModel ?? fleetModel!

  return (
    <div className="city-root">
      <SceneBoundary>
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{
            position: [size * 0.9, size * 0.75, size * 0.9],
            fov: 40,
            near: 0.5,
            far: size * 30
          }}
          onPointerMissed={() => useStore.getState().setSelected(null)}
        >
          <color attach="background" args={[bg]} />
          {viewMode === 'city' && (
            <fog attach="fog" args={[bg, size * theme.fog.near, size * theme.fog.far]} />
          )}

          {cityModel && cityTargets && (
            <CityScene model={cityModel} targets={cityTargets} snapshot={snapshot} />
          )}
          {fleetModel && fleetTgt && <FleetScene model={fleetModel} targets={fleetTgt} />}

          <CameraRig
            worldSize={size}
            resolveFocus={resolveFocus}
            maxPolarAngle={viewMode === 'fleet' ? Math.PI * 0.9 : Math.PI * 0.47}
          />

          {/* AO only exists in the city; its presence changes the composer's child
            set. Rebuilding that chain in place freezes the render loop, so key the
            composer on the exact combination that alters its children — the change
            becomes a clean remount instead of an in-place mutation. */}
          <EffectComposer key={`fx-${useAO ? 'ao' : 'noao'}`} enableNormalPass={useAO}>
            {useAO ? (
              <N8AO aoRadius={size * 0.06} intensity={2.4} distanceFalloff={1} halfRes />
            ) : (
              <></>
            )}
            <Bloom
              luminanceThreshold={theme.bloom.threshold}
              intensity={viewMode === 'fleet' ? theme.bloom.intensity * 1.3 : theme.bloom.intensity}
              mipmapBlur
            />
            <Vignette darkness={theme.vignette} />
          </EffectComposer>
        </Canvas>
      </SceneBoundary>

      <Hud snapshot={snapshot} model={hudModel} />
      <ChangesPanel />
      <BranchesPanel />
      <StashPanel />
      <DiffPanel />
      <FileHistoryPanel />
      <CommitGraphPanel />
      <RebasePanel />
      <ReflogPanel />
      <MergeView />
    </div>
  )
}
