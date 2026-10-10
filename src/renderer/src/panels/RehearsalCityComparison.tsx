import { createPortal } from 'react-dom'
import SceneEffects from '../city/SceneEffects'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import type {
  RehearsalComparison,
  RehearsalReport,
  RehearsalReviewEntry,
  RehearsalReviewEntrySummary
} from '../../../shared/types'
import { materializeSnapshot } from '../../../shared/snapshots'
import { useStore } from '../store'
import { getMode } from '../city/modes'
import { getTheme } from '../city/themes'
import CameraRig from '../city/CameraRig'
import SceneBoundary from '../lib/SceneBoundary'
import { snapshotHasPath, type RehearsalReviewMarker } from '../city/rehearsalMarkers'

let rehearsalSceneHost: HTMLDivElement | null = null
const rehearsalSceneHostSubscribers = new Set<() => void>()

/**
 * The comparison lives in the rehearsal panel, while its one WebGL canvas
 * belongs in the workspace. Registering the host from SceneView avoids looking
 * it up during render, when the scene may still be mounting or may be in the
 * middle of unmounting.
 */
export function setRehearsalSceneHost(host: HTMLDivElement | null): void {
  rehearsalSceneHost = host
  for (const subscriber of rehearsalSceneHostSubscribers) subscriber()
}

function useRehearsalSceneHost(): HTMLDivElement | null {
  return useSyncExternalStore(
    (subscriber) => {
      rehearsalSceneHostSubscribers.add(subscriber)
      return () => rehearsalSceneHostSubscribers.delete(subscriber)
    },
    () => rehearsalSceneHost,
    () => null
  )
}

function Comparison({
  data,
  onReturn,
  reviewPaths = [],
  reviewMarkers = [],
  selectedPath,
  selectedEntry,
  onSelectPath
}: {
  data: RehearsalComparison
  onReturn(): void
  reviewPaths?: string[]
  reviewMarkers?: RehearsalReviewMarker[]
  selectedPath?: string | null
  selectedEntry?: RehearsalReviewEntry | RehearsalReviewEntrySummary | null
  onSelectPath?: (path: string, endpoint: 'before' | 'after') => void
}): React.JSX.Element {
  const [side, setSide] = useState(0)
  const before = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (document.activeElement?.closest('.rehearsal-panel')) before.current?.focus()
  }, [])
  const viewMode = useStore((s) => s.viewMode)
  const colorMode = useStore((s) => s.colorMode)
  const themeId = useStore((s) => s.themeId)
  const sceneHost = useRehearsalSceneHost()
  const mode = getMode(viewMode)
  const theme = getTheme(themeId)
  const snapshot = useMemo(() => materializeSnapshot(data.analysis, side), [data, side])
  // Both endpoints share a layout, so toggling preserves camera and file positions.
  const scene = useMemo(
    () => mode.prepare(data.analysis, snapshot, colorMode),
    [mode, data, snapshot, colorMode]
  )
  // The endpoint changes targets but not layout. Keep this callback stable so
  // CameraRig retains its current target instead of flying again on each toggle.
  const focusRef = useRef(scene.focus)
  focusRef.current = scene.focus
  const resolveFocus = useCallback((path: string) => focusRef.current(path), [])
  const endpointPath = selectedEntry
    ? side === 0
      ? selectedEntry.oldPath
      : selectedEntry.newPath
    : selectedPath
  const endpointPresent = selectedEntry
    ? side === 0
      ? selectedEntry.old.present
      : selectedEntry.new.present
    : endpointPath
      ? snapshotHasPath(snapshot, endpointPath)
      : true
  const selectedRepresented = endpointPath ? resolveFocus(endpointPath) !== null : false
  const endpoint = side === 0 ? 'before' : 'after'
  const endpointMarkers = reviewMarkers.filter(
    (marker) => !marker.endpoint || marker.endpoint === endpoint
  )
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
        <button onClick={onReturn}>Return to live city</button>
      </div>
      <p role="status">
        {side === 0 ? 'Before' : 'After'} · Rehearsal {data.identity.id} · {snapshot.files.length}{' '}
        files · {snapshot.files.reduce((sum, file) => sum + file.loc, 0)} lines
      </p>
      <p>{data.notice}</p>
      {endpointMarkers.length > 0 && (
        <div className="rehearsal-city-marker-legend" aria-label="Review change markers">
          {[...new Map(endpointMarkers.map((marker) => [marker.change, marker])).values()].map(
            (marker) => (
              <span className={`review-marker review-marker-${marker.change}`} key={marker.change}>
                {marker.label}
              </span>
            )
          )}
        </div>
      )}
      {selectedEntry && !endpointPresent && (
        <p className="rehearsal-city-note" role="status">
          This file is absent from the {side === 0 ? 'Before' : 'After'} endpoint; frozen text
          review remains available.
        </p>
      )}
      {endpointPath && endpointPresent && !selectedRepresented && (
        <p className="rehearsal-city-note" role="status">
          City context is unavailable for this file; frozen text review remains available.
        </p>
      )}
      {sceneHost &&
        createPortal(
          <div
            className="rehearsal-city"
            aria-label={`${side === 0 ? 'Before' : 'After'} rehearsal city`}
          >
            <SceneBoundary>
              <Canvas
                shadows
                dpr={[1, 1.5]}
                onCreated={(state) => {
                  state.events.enabled = true
                }}
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
                {scene.render({
                  snapshot,
                  hotspots: [],
                  reviewPaths,
                  reviewMarkers: endpointMarkers,
                  liveWorktree: false,
                  selectedPath: endpointPath,
                  onSelectPath: (path) => onSelectPath?.(path, endpoint)
                })}
                <CameraRig
                  worldSize={scene.worldSize}
                  resolveFocus={resolveFocus}
                  selectedPath={endpointPath}
                />
                <SceneEffects theme={theme} useAO={theme.ao && mode.ao} size={scene.worldSize} />
              </Canvas>
            </SceneBoundary>
          </div>,
          sceneHost
        )}
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
  report,
  reviewPaths,
  reviewMarkers,
  selectedPath,
  selectedEntry,
  onSelectPath
}: {
  report: RehearsalReport
  reviewPaths?: string[]
  reviewMarkers?: RehearsalReviewMarker[]
  selectedPath?: string | null
  selectedEntry?: RehearsalReviewEntry | RehearsalReviewEntrySummary | null
  onSelectPath?: (path: string, endpoint: 'before' | 'after') => void
}): React.JSX.Element {
  const comparison = useStore((s) => s.rehearsalComparison)
  const busy = useStore((s) => s.rehearsalBusy)
  const compare = useStore((s) => s.compareRehearsal)
  const clear = useStore((s) => s.clearRehearsalComparison)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const current = !busy && comparison?.report === report ? comparison : null
  return (
    <section aria-label="Rehearsal city comparison">
      <h3 ref={heading} tabIndex={-1}>
        City before / after
      </h3>
      <button
        ref={trigger}
        disabled={busy || current?.loading}
        onClick={() => {
          heading.current?.focus()
          void compare(report)
        }}
      >
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
          reviewPaths={reviewPaths}
          reviewMarkers={reviewMarkers}
          selectedPath={selectedPath}
          selectedEntry={selectedEntry}
          onSelectPath={onSelectPath}
          onReturn={() => {
            clear()
            trigger.current?.focus()
          }}
        />
      )}
    </section>
  )
}
