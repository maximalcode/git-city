import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import { Vector3 } from 'three'
import CameraRig from './CameraRig'
import SceneBoundary from '../lib/SceneBoundary'
import { useStore } from '../store'
import { playStepMs } from '../lib/playback'
import { hotspots as computeHotspots } from '../lib/hotspots'
import { getTheme } from './themes'
import { buildCityModel, snapshotTargets, type CityModel } from './cityData'
import { buildForestModel, forestTargets, type ForestModel } from '../layout/forest'
import type { RepoAnalysis } from '../../../shared/types'
import CityScene from './CityScene'
import ForestScene from './ForestScene'
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
import CommandPalette from './CommandPalette'
import Onboarding from './Onboarding'
import Minimap from './Minimap'
import CommitDetailPanel from '../panels/CommitDetailPanel'

// Per-analysis model caches: toggling the view mode back and forth must not
// re-run the layout algorithms.
const cityCache = new WeakMap<RepoAnalysis, CityModel>()
const forestCache = new WeakMap<RepoAnalysis, ForestModel>()

function getCityModel(analysis: RepoAnalysis): CityModel {
  let m = cityCache.get(analysis)
  if (!m) {
    m = buildCityModel(analysis)
    cityCache.set(analysis, m)
  }
  return m
}

function getForestModel(analysis: RepoAnalysis): ForestModel {
  let m = forestCache.get(analysis)
  if (!m) {
    m = buildForestModel(analysis)
    forestCache.set(analysis, m)
  }
  return m
}

/**
 * Mode-agnostic scene shell: owns the Canvas, fog, playback ticker, camera
 * rig, postprocessing, HUD and panels. The view-mode-specific world (city or
 * forest) mounts as a subtree.
 */
export default function SceneView(): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)!
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const colorMode = useStore((s) => s.colorMode)
  const themeId = useStore((s) => s.themeId)
  const theme = getTheme(themeId)
  const playing = useStore((s) => s.playing)
  const viewMode = useStore((s) => s.viewMode)
  const showHotspots = useStore((s) => s.showHotspots)

  // A lost/hung WebGL context (driver reset, GPU pressure after many scene
  // rebuilds) freezes the canvas silently — a React error boundary can't catch
  // it. Handle it explicitly: log why, then offer a full remount. `canvasKey`
  // forces a fresh GL context on recovery.
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const onCanvasCreated = useCallback(({ gl }: { gl: { domElement: HTMLCanvasElement } }) => {
    gl.domElement.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault() // allow restoration instead of a permanent loss
        console.error('[git-city] WebGL context lost — offering scene reload')
        setContextLost(true)
      },
      false
    )
  }, [])
  const reloadScene = (): void => {
    setContextLost(false)
    setCanvasKey((k) => k + 1)
  }

  const snapshot = analysis.snapshots[Math.min(snapshotIndex, analysis.snapshots.length - 1)]

  const hotspotPaths = useMemo(
    () => (showHotspots ? computeHotspots(snapshot) : []),
    [showHotspots, snapshot]
  )

  // only the active mode's model is built (lazily, cached per analysis)
  const cityModel = viewMode === 'city' ? getCityModel(analysis) : null
  const forestModel = viewMode === 'forest' ? getForestModel(analysis) : null

  const cityTargets = useMemo(
    () => (cityModel ? snapshotTargets(cityModel, snapshot, colorMode) : null),
    [cityModel, snapshot, colorMode]
  )
  const forestTgt = useMemo(
    () => (forestModel ? forestTargets(forestModel, snapshot, colorMode) : null),
    [forestModel, snapshot, colorMode]
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

  const size = cityModel ? cityModel.citySize : forestModel!.worldSize
  const bg = theme.background
  const useAO = theme.ao && viewMode === 'city'

  // fly-to target: building plot center in the city, tree position in the forest
  const resolveFocus = useMemo(
    () =>
      (path: string): Vector3 | null => {
        if (cityModel) {
          const i = cityModel.indexOf.get(path)
          if (i === undefined) return null
          const { rect } = cityModel.layout.plots[i]
          return new Vector3(rect.x + rect.w / 2, 5, rect.y + rect.h / 2)
        }
        const m = forestModel!
        const i = m.indexOf.get(path)
        if (i === undefined) return null
        return new Vector3(m.positions[i * 3], 4, m.positions[i * 3 + 2])
      },
    [cityModel, forestModel]
  )

  const hudModel = cityModel ?? forestModel!

  if (contextLost) {
    return (
      <div className="city-root">
        <div className="scene-error">
          <div className="scene-error-card">
            <h2>Graphics reset</h2>
            <p>The GPU context dropped. Your repository and changes are untouched.</p>
            <button className="primary" onClick={reloadScene}>
              Reload view
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="city-root">
      <SceneBoundary>
        <Canvas
          key={canvasKey}
          shadows
          dpr={[1, 1.75]}
          camera={{
            position: [size * 0.9, size * 0.75, size * 0.9],
            fov: 40,
            near: 0.5,
            far: size * 30
          }}
          onCreated={onCanvasCreated}
          onPointerMissed={() => useStore.getState().setSelected(null)}
        >
          <color attach="background" args={[bg]} />
          <fog attach="fog" args={[bg, size * theme.fog.near, size * theme.fog.far]} />

          {cityModel && cityTargets && (
            <CityScene
              model={cityModel}
              targets={cityTargets}
              snapshot={snapshot}
              hotspots={hotspotPaths}
            />
          )}
          {forestModel && forestTgt && (
            <ForestScene model={forestModel} targets={forestTgt} hotspots={hotspotPaths} />
          )}

          <CameraRig worldSize={size} resolveFocus={resolveFocus} maxPolarAngle={Math.PI * 0.47} />

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
              intensity={theme.bloom.intensity}
              mipmapBlur
            />
            <Vignette darkness={theme.vignette} />
          </EffectComposer>
        </Canvas>
      </SceneBoundary>

      <Hud snapshot={snapshot} model={hudModel} />
      <Minimap model={cityModel ?? forestModel!} viewMode={viewMode} />
      <CommandPalette model={hudModel} />
      <CommitDetailPanel />
      <Onboarding />
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
