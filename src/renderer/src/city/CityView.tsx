import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import CameraControls from './CameraControls'
import { useStore } from '../store'
import { getTheme } from './themes'
import { buildCityModel, snapshotTargets } from './cityData'
import Buildings from './Buildings'
import Districts from './Districts'
import Highlight from './Highlight'
import StatusOverlay from './StatusOverlay'
import ConstructionSites from './ConstructionSites'
import Effects from './Effects'
import SkyDome from './SkyDome'
import Traffic from './Traffic'
import Hud from './Hud'
import ChangesPanel from '../panels/ChangesPanel'
import BranchesPanel from '../panels/BranchesPanel'
import StashPanel from '../panels/StashPanel'
import MergeView from '../panels/MergeView'
import DiffPanel from '../panels/DiffPanel'
import FileHistoryPanel from '../panels/FileHistoryPanel'
import CommitGraphPanel from '../panels/CommitGraphPanel'
import RebasePanel from '../panels/RebasePanel'

const PLAY_STEP_MS = 800

export default function CityView(): React.JSX.Element {
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

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const s = useStore.getState()
      if (!s.analysis || s.snapshotIndex >= s.analysis.snapshots.length - 1) {
        useStore.setState({ playing: false })
      } else {
        useStore.setState({ snapshotIndex: s.snapshotIndex + 1 })
      }
    }, PLAY_STEP_MS)
    return () => clearInterval(id)
  }, [playing])

  const size = model.citySize
  const bg = theme.background

  return (
    <div className="city-root">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [size * 0.9, size * 0.75, size * 0.9], fov: 40, near: 0.5, far: size * 30 }}
        onPointerMissed={() => useStore.getState().setSelected(null)}
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, size * theme.fog.near, size * theme.fog.far]} />

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
        <Buildings model={model} targets={targets} />
        <Highlight model={model} targets={targets} />
        <StatusOverlay model={model} targets={targets} />
        <ConstructionSites model={model} />
        <Traffic model={model} snapshot={snapshot} />
        <Effects citySize={size} />

        <CameraControls maxDistance={size * 4} model={model} />

        <EffectComposer enableNormalPass={theme.ao}>
          {theme.ao ? (
            <N8AO aoRadius={size * 0.06} intensity={2.4} distanceFalloff={1} halfRes />
          ) : (
            <></>
          )}
          <Bloom luminanceThreshold={theme.bloom.threshold} intensity={theme.bloom.intensity} mipmapBlur />
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
