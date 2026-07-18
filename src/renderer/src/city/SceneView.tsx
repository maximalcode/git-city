import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import { Vector3 } from 'three'
import CameraRig from './CameraRig'
import { useStore } from '../store'
import { playStepMs } from '../lib/playback'
import { getTheme } from './themes'
import { buildCityModel, snapshotTargets } from './cityData'
import CityScene from './CityScene'
import Hud from './Hud'
import ChangesPanel from '../panels/ChangesPanel'
import BranchesPanel from '../panels/BranchesPanel'
import StashPanel from '../panels/StashPanel'
import MergeView from '../panels/MergeView'
import DiffPanel from '../panels/DiffPanel'
import FileHistoryPanel from '../panels/FileHistoryPanel'
import CommitGraphPanel from '../panels/CommitGraphPanel'
import RebasePanel from '../panels/RebasePanel'

/**
 * Mode-agnostic scene shell: owns the Canvas, fog, playback ticker, camera
 * rig, postprocessing, HUD and panels. The view-mode-specific world (city
 * today, fleet next) mounts as a subtree.
 */
export default function SceneView(): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)!
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const colorMode = useStore((s) => s.colorMode)
  const themeId = useStore((s) => s.themeId)
  const theme = getTheme(themeId)
  const playing = useStore((s) => s.playing)

  const model = useMemo(() => buildCityModel(analysis), [analysis])
  const snapshot = analysis.snapshots[Math.min(snapshotIndex, analysis.snapshots.length - 1)]
  const targets = useMemo(
    () => snapshotTargets(model, snapshot, colorMode),
    [model, snapshot, colorMode]
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

  const size = model.citySize
  const bg = theme.background

  // fly-to target for the camera: center of the selected building's plot
  const resolveFocus = useMemo(
    () =>
      (path: string): Vector3 | null => {
        const i = model.indexOf.get(path)
        if (i === undefined) return null
        const { rect } = model.layout.plots[i]
        return new Vector3(rect.x + rect.w / 2, 5, rect.y + rect.h / 2)
      },
    [model]
  )

  return (
    <div className="city-root">
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
        <fog attach="fog" args={[bg, size * theme.fog.near, size * theme.fog.far]} />

        <CityScene model={model} targets={targets} snapshot={snapshot} />

        <CameraRig worldSize={size} resolveFocus={resolveFocus} />

        <EffectComposer enableNormalPass={theme.ao}>
          {theme.ao ? (
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

      <Hud snapshot={snapshot} model={model} />
      <ChangesPanel />
      <BranchesPanel />
      <StashPanel />
      <DiffPanel />
      <FileHistoryPanel />
      <CommitGraphPanel />
      <RebasePanel />
      <MergeView />
    </div>
  )
}
