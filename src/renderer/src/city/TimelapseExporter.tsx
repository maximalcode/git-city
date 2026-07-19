import { useEffect, useRef, type RefObject } from 'react'
import { useStore } from '../store'
import { pickTimelapseMime, timelapseFileName } from '../lib/timelapse'

const FPS = 30
const TAIL_MS = 500 // hold on the final frame so it lands in the clip

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Save a blob to disk via a transient download link (the app's own output). */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * Records the timeline playback to a WebM clip. When `exporting` flips true it
 * grabs the live WebGL canvas's captureStream, replays history from the first
 * snapshot to the last while a MediaRecorder captures it, then saves the file.
 * Uses only the browser's own MediaRecorder — no new runtime dependency.
 *
 * Rendered outside the R3F <Canvas> but handed the canvas element via a ref so
 * it can call captureStream on the exact drawing surface.
 */
export default function TimelapseExporter({
  canvasRef
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
}): React.JSX.Element | null {
  const exporting = useStore((s) => s.exporting)
  const exportError = useStore((s) => s.exportError)
  const endExport = useStore((s) => s.endExport)
  const cancelRef = useRef(false)

  // auto-clear a surfaced error after a few seconds
  useEffect(() => {
    if (!exportError) return
    const id = setTimeout(() => endExport(null), 5000)
    return () => clearTimeout(id)
  }, [exportError, endExport])

  useEffect(() => {
    if (!exporting) return
    cancelRef.current = false
    const canvas = canvasRef.current
    const store = useStore
    const { analysis, endExport } = store.getState()

    const mime = pickTimelapseMime()
    if (!canvas || typeof canvas.captureStream !== 'function' || !mime || !analysis) {
      endExport('Video recording is not supported here.')
      return
    }

    const last = analysis.snapshots.length - 1
    // remember where the user was so we can restore it afterwards
    const restoreIndex = store.getState().snapshotIndex

    let recorder: MediaRecorder | null = null
    let cancelled = false

    const run = async (): Promise<void> => {
      const stream = canvas.captureStream(FPS)
      const chunks: Blob[] = []
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      const stopped = new Promise<void>((res) => {
        recorder!.onstop = (): void => res()
      })

      recorder.start(100)
      // rewind and play the whole history; the SceneView ticker advances it
      store.setState({ snapshotIndex: 0, playing: true })

      // wait until playback reaches the last snapshot (or the user cancels)
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (cancelRef.current) {
            cancelled = true
            resolve()
            return
          }
          const s = store.getState()
          if (s.snapshotIndex >= last) {
            resolve()
            return
          }
          setTimeout(check, 60)
        }
        check()
      })

      if (!cancelled) await delay(TAIL_MS)
      store.setState({ playing: false })
      recorder.stop()
      await stopped

      if (cancelled) {
        endExport(null)
      } else {
        const blob = new Blob(chunks, { type: mime })
        if (blob.size === 0) {
          // no frames captured (e.g. the window was never composited)
          endExport('Recording produced no frames — try again with the window visible.')
        } else {
          saveBlob(blob, timelapseFileName(analysis.info.name))
          endExport(null)
        }
      }
      // restore the user's original frame
      store.setState({ snapshotIndex: restoreIndex })
    }

    run().catch(() => {
      try {
        recorder?.stop()
      } catch {
        /* already stopped */
      }
      store.setState({ playing: false })
      endExport('Time-lapse export failed.')
    })

    return () => {
      cancelRef.current = true
    }
  }, [exporting, canvasRef])

  if (exportError && !exporting) {
    return (
      <div className="export-overlay error" role="alert">
        <span>{exportError}</span>
        <button onClick={() => endExport(null)}>Dismiss</button>
      </div>
    )
  }

  if (!exporting) return null

  return (
    <div className="export-overlay">
      <span className="spinner" />
      <span>Recording time-lapse…</span>
      <button onClick={() => (cancelRef.current = true)}>Cancel</button>
    </div>
  )
}
