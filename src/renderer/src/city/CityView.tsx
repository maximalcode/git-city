import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import CameraControls from './CameraControls'
import { useStore } from '../store'
import { buildCityModel, snapshotTargets } from './cityData'
import Buildings from './Buildings'
import Districts from './Districts'
import Highlight from './Highlight'
import StatusOverlay from './StatusOverlay'
import ConstructionSites from './ConstructionSites'
import Effects from './Effects'
import Hud from './Hud'
import ChangesPanel from '../panels/ChangesPanel'
import BranchesPanel from '../panels/BranchesPanel'
import StashPanel from '../panels/StashPanel'
import MergeView from '../panels/MergeView'

const PLAY_STEP_MS = 800

export default function CityView(): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)!
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const colorMode = useStore((s) => s.colorMode)
  const night = useStore((s) => s.night)
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
  const bg = night ? '#070a12' : '#0e1420'

  return (
    <div className="city-root">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [size * 0.9, size * 0.75, size * 0.9], fov: 40, near: 0.5, far: size * 30 }}
        onPointerMissed={() => useStore.getState().setSelected(null)}
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, size * 1.6, size * 6]} />

        <hemisphereLight
          args={night ? ['#3a4a7a', '#0a0c14', 0.35] : ['#bcd4ff', '#2a2418', 0.55]}
        />
        <directionalLight
          position={[size * 0.7, size * 1.1, size * 0.4]}
          intensity={night ? 0.5 : 1.6}
          color={night ? '#8fa8ff' : '#ffe3b8'}
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
          intensity={night ? 0.15 : 0.35}
          color={night ? '#4a5a9a' : '#a8c8ff'}
        />

        {/* ground */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
          <planeGeometry args={[size * 12, size * 12]} />
          <meshStandardMaterial color={night ? '#0a0e18' : '#151c2b'} roughness={1} />
        </mesh>

        <Districts model={model} />
        <Buildings model={model} targets={targets} />
        <Highlight model={model} targets={targets} />
        <StatusOverlay model={model} targets={targets} />
        <ConstructionSites model={model} />
        <Effects citySize={size} />

        <CameraControls maxDistance={size * 4} />

        <EffectComposer>
          <Bloom luminanceThreshold={0.9} intensity={night ? 0.9 : 0.45} mipmapBlur />
          <Vignette darkness={night ? 0.65 : 0.45} />
        </EffectComposer>
      </Canvas>

      <Hud snapshot={snapshot} model={model} />
      <ChangesPanel />
      <BranchesPanel />
      <StashPanel />
      <MergeView />
    </div>
  )
}
