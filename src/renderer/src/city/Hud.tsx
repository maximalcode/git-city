import { useMemo } from 'react'
import type { Snapshot } from '../../../shared/types'
import { languageOf } from '../lib/languages'
import { useStore } from '../store'
import type { CityModel } from './cityData'

interface Props {
  snapshot: Snapshot
  model: CityModel
}

export default function Hud({ snapshot }: Props): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)!
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const setSnapshotIndex = useStore((s) => s.setSnapshotIndex)
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  const night = useStore((s) => s.night)
  const toggleNight = useStore((s) => s.toggleNight)
  const hovered = useStore((s) => s.hovered)
  const selected = useStore((s) => s.selected)
  const setSelected = useStore((s) => s.setSelected)
  const backToWelcome = useStore((s) => s.backToWelcome)

  const byPath = useMemo(() => new Map(snapshot.files.map((f) => [f.path, f])), [snapshot])
  const totalLoc = useMemo(() => snapshot.files.reduce((a, f) => a + f.loc, 0), [snapshot])

  const last = analysis.snapshots.length - 1
  const hoveredFile = hovered ? byPath.get(hovered) : undefined
  const selectedFile = selected ? byPath.get(selected) : undefined
  const date = new Date(snapshot.date)

  return (
    <>
      <div className="hud-top">
        <span className="repo-name">{analysis.info.name}</span>
        <span className="branch">{analysis.info.branch}</span>
        <span className="branch">
          {snapshot.files.length.toLocaleString()} files · {totalLoc.toLocaleString()} lines
        </span>
        <div className="spacer" />
        <button
          className={colorMode === 'language' ? 'active' : ''}
          onClick={() => setColorMode('language')}
          title="Color buildings by file language"
        >
          Language
        </button>
        <button
          className={colorMode === 'heat' ? 'active' : ''}
          onClick={() => setColorMode('heat')}
          title="Color buildings by how often they change"
        >
          Activity
        </button>
        <button onClick={toggleNight}>{night ? '☀ Day' : '☾ Night'}</button>
        <button onClick={backToWelcome}>⌂ Open another</button>
      </div>

      {hoveredFile && hovered !== selected && (
        <div className="tooltip" style={{ left: 16, bottom: 96 }}>
          <div className="path">{hoveredFile.path}</div>
          <div className="meta">
            {languageOf(hoveredFile.path).name} · {hoveredFile.loc.toLocaleString()} lines ·{' '}
            {hoveredFile.commits} commit{hoveredFile.commits === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {selectedFile && (
        <div className="details">
          <button className="close" onClick={() => setSelected(null)}>
            ✕
          </button>
          <div className="path">{selectedFile.path}</div>
          <div className="row">
            <span>Language</span>
            <span>
              <span
                className="lang-chip"
                style={{ background: languageOf(selectedFile.path).color }}
              />
              {languageOf(selectedFile.path).name}
            </span>
          </div>
          <div className="row">
            <span>Lines</span>
            <span>{selectedFile.binary ? 'binary' : selectedFile.loc.toLocaleString()}</span>
          </div>
          <div className="row">
            <span>Commits</span>
            <span>{selectedFile.commits.toLocaleString()}</span>
          </div>
          <div className="row">
            <span>Last change</span>
            <span>{new Date(selectedFile.lastTouched).toLocaleDateString()}</span>
          </div>
          <div className="row">
            <span>Last author</span>
            <span>{selectedFile.lastAuthor}</span>
          </div>
        </div>
      )}

      <div className="hud-bottom">
        <div className="commit-info">
          <span className="hash">{snapshot.hash.slice(0, 7)}</span>
          <span className="msg" title={snapshot.message}>
            {snapshot.message}
          </span>
          <span>
            {snapshot.author} · {date.toLocaleDateString()} · commit {snapshot.index + 1} of{' '}
            {analysis.info.commitCount.toLocaleString()}
          </span>
        </div>
        <div className="timeline-row">
          <button className="play" onClick={() => setPlaying(!playing)} title="Play history">
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={Math.min(snapshotIndex, last)}
            onChange={(e) => setSnapshotIndex(Number(e.target.value))}
          />
        </div>
      </div>
    </>
  )
}
