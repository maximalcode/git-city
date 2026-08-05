import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import CameraRig from './CameraRig'
import SceneBoundary from '../lib/SceneBoundary'
import { useStore } from '../store'
import { playStepMs } from '../lib/playback'
import { hotspots as computeHotspots } from '../lib/hotspots'
import { materializeSnapshot } from '../../../shared/snapshots'
import { getTheme } from './themes'
import { getMode } from './modes'
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
import PullRequestsPanel from '../panels/PullRequestsPanel'
import SettingsPanel from '../panels/SettingsPanel'
import ReviewBanner from '../panels/ReviewBanner'
import TimelapseExporter from './TimelapseExporter'
import CommandPalette from './CommandPalette'
import Onboarding from './Onboarding'
import Minimap from './Minimap'
import CommitDetailPanel from '../panels/CommitDetailPanel'

// stable empty array so "no PR under review" never churns scene props
const EMPTY_PATHS: string[] = []

/**
 * Mode-agnostic scene shell: owns the Canvas, fog, playback ticker, camera
 * rig, postprocessing, HUD and panels. The view-mode-specific world mounts as a
 * subtree, looked up in the mode registry (see modes.tsx) — this shell contains
 * no per-mode branching.
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
  // the live drawing surface, handed to the time-lapse exporter for captureStream
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const onCanvasCreated = useCallback(({ gl }: { gl: { domElement: HTMLCanvasElement } }) => {
    canvasElRef.current = gl.domElement
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

  // The analysis stores snapshots columnar (#62); only the timeline position
  // actually on screen is ever materialized back into objects.
  const snapshot = useMemo(
    () => materializeSnapshot(analysis, Math.min(snapshotIndex, analysis.snapshots.length - 1)),
    [analysis, snapshotIndex]
  )

  const hotspotPaths = useMemo(
    () => (showHotspots ? computeHotspots(snapshot) : []),
    [showHotspots, snapshot]
  )

  const reviewPaths = useStore((s) => s.review?.paths) ?? EMPTY_PATHS

  // only the active mode is prepared; each entry caches its model per analysis
  const mode = getMode(viewMode)
  const scene = useMemo(
    () => mode.prepare(analysis, snapshot, colorMode),
    [mode, analysis, snapshot, colorMode]
  )

  // A PR's added files do not exist on this branch, so the model cannot place
  // them: they never glow, and the banner's ‹ › stepper landed on them with no
  // camera move and no highlight while the counter insisted they were there.
  // Splitting them out is what lets the banner say so (#30).
  const locatablePaths = useMemo(
    () => reviewPaths.filter((p) => scene.focus(p) !== null),
    [reviewPaths, scene]
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

  const size = scene.worldSize
  const bg = theme.background
  const useAO = theme.ao && mode.ao

  const resolveFocus = useMemo(() => (path: string) => scene.focus(path), [scene])

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
          // cameraScale: the farm's detail is at ground level, so the city's
          // framing left its herds and lit barns as specks (#22)
          camera={{
            position: [
              size * 0.9 * mode.cameraScale,
              size * 0.75 * mode.cameraScale,
              size * 0.9 * mode.cameraScale
            ],
            fov: 40,
            near: 0.5,
            far: size * 30
          }}
          onCreated={onCanvasCreated}
          onPointerMissed={() => useStore.getState().setSelected(null)}
        >
          <color attach="background" args={[bg]} />
          <fog attach="fog" args={[bg, size * theme.fog.near, size * theme.fog.far]} />

          {scene.render({ snapshot, hotspots: hotspotPaths, reviewPaths })}

          <CameraRig worldSize={size} resolveFocus={resolveFocus} maxPolarAngle={Math.PI * 0.47} />

          {/* Only some modes use AO; its presence changes the composer's child
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

      <Hud snapshot={snapshot} model={scene.hud} />
      <Minimap dots={scene.dots()} worldSize={size} />
      <CommandPalette model={scene.hud} />
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
      <PullRequestsPanel />
      <SettingsPanel />
      <ReviewBanner locatable={locatablePaths} />
      <TimelapseExporter canvasRef={canvasElRef} />
      <MergeView />
    </div>
  )
}
