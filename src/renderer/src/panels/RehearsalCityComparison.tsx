import SceneEffects from '../city/SceneEffects'
import { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import type { RehearsalComparison, RehearsalReport } from '../../../shared/types'
import { materializeSnapshot } from '../../../shared/snapshots'
import { useStore } from '../store'
import { getMode } from '../city/modes'
import { getTheme } from '../city/themes'
import CameraRig from '../city/CameraRig'
import SceneBoundary from '../lib/SceneBoundary'

function Comparison({ data }: { data: RehearsalComparison }): React.JSX.Element {
  const [side, setSide] = useState(0)
  const before = useRef<HTMLButtonElement>(null)
  const viewMode = useStore((s) => s.viewMode)
  const colorMode = useStore((s) => s.colorMode)
  const themeId = useStore((s) => s.themeId)
  const mode = getMode(viewMode)
  const theme = getTheme(themeId)
  const snapshot = useMemo(() => materializeSnapshot(data.analysis, side), [data, side])
  // Both endpoints share a layout, so toggling preserves camera and file positions.
  const scene = useMemo(
    () => mode.prepare(data.analysis, snapshot, colorMode),
    [mode, data, snapshot, colorMode]
  )
  const resolveFocus = useMemo(() => (path: string) => scene.focus(path), [scene])
  useEffect(() => {
    before.current?.focus()
  }, [])
  return (
    <>
      <div role="group" aria-label="Rehearsal city endpoint">
        <button ref={before} aria-pressed={side === 0} onClick={() => setSide(0)}>
          Before
        </button>
        <button
          aria-pressed={side === 1}
          disabled={!data.afterAvailable}
          onClick={() => setSide(1)}
        >
          After
        </button>
      </div>
      <p role="status">
        {side === 0 ? 'Before' : 'After'} · Rehearsal {data.identity.id} · {snapshot.files.length}{' '}
        files · {snapshot.files.reduce((sum, file) => sum + file.loc, 0)} lines
      </p>
      <p>{data.notice}</p>
      <div
        className="rehearsal-city"
        aria-label={`${side === 0 ? 'Before' : 'After'} rehearsal city`}
      >
        <SceneBoundary>
          <Canvas
            shadows
            onCreated={({ setEvents }) => setEvents({ enabled: false })}
            dpr={[1, 1.5]}
            camera={{
              position: [
                scene.worldSize * mode.cameraScale,
                scene.worldSize * mode.cameraScale,
                scene.worldSize * mode.cameraScale
              ],
              fov: 40,
              near: 0.5,
              far: scene.worldSize * 30
            }}
          >
            <color attach="background" args={[theme.background]} />
            {scene.render({ snapshot, hotspots: [], reviewPaths: [], liveWorktree: false })}
            <CameraRig worldSize={scene.worldSize} resolveFocus={resolveFocus} />
            <SceneEffects theme={theme} useAO={theme.ao && mode.ao} size={scene.worldSize} />
          </Canvas>
        </SceneBoundary>
      </div>
      <details>
        <summary>Snapshot files and line counts</summary>
        <ul>
          {snapshot.files.map((file) => (
            <li key={file.path}>
              {file.path}: {file.binary ? 'binary' : `${file.loc} lines`}
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

export default function RehearsalCityComparison({
  report
}: {
  report: RehearsalReport
}): React.JSX.Element {
  const comparison = useStore((s) => s.rehearsalComparison)
  const busy = useStore((s) => s.rehearsalBusy)
  const compare = useStore((s) => s.compareRehearsal)
  const current = !busy && comparison?.report === report ? comparison : null
  return (
    <section aria-label="Rehearsal city comparison">
      <h3>City before / after</h3>
      <button disabled={busy || current?.loading} onClick={() => void compare(report)}>
        {current?.loading
          ? 'Analyzing rehearsal…'
          : current?.data
            ? 'Refresh city comparison'
            : 'Compare city'}
      </button>
      {current?.error && <p role="alert">⚠ {current.error}</p>}
      {current?.data && (
        <Comparison
          key={`${report.id}:${current.data.analysis.snapshots.map((s) => s.hash).join(':')}`}
          data={current.data}
        />
      )}
    </section>
  )
}
