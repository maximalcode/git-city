import { useMemo } from 'react'
import type { Snapshot } from '../../../shared/types'
import { languageOf } from '../lib/languages'
import { useHotkeys } from '../lib/useHotkeys'
import { AheadBehind, formatDate } from '../lib/format'
import Picker from '../lib/Picker'
import { useStore, type ColorMode } from '../store'
import type { CityModel } from './cityData'
import { THEMES, getTheme } from './themes'
import { COLOR_MODES } from './colorModes'
import Legend from './Legend'
import SearchBox from './SearchBox'

interface Props {
  snapshot: Snapshot
  model: CityModel
}

export default function Hud({ snapshot, model }: Props): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)!
  const snapshotIndex = useStore((s) => s.snapshotIndex)
  const setSnapshotIndex = useStore((s) => s.setSnapshotIndex)
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  const themeId = useStore((s) => s.themeId)
  const setTheme = useStore((s) => s.setTheme)
  const hovered = useStore((s) => s.hovered)
  const selected = useStore((s) => s.selected)
  const setSelected = useStore((s) => s.setSelected)
  const backToWelcome = useStore((s) => s.backToWelcome)
  const workingStatus = useStore((s) => s.workingStatus)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const opInProgress = useStore((s) => s.opInProgress)
  const reanalyzing = useStore((s) => s.reanalyzing)
  const historyStale = useStore((s) => s.historyStale)
  const graphOpen = useStore((s) => s.graphOpen)
  const setGraphOpen = useStore((s) => s.setGraphOpen)
  const fetch = useStore((s) => s.fetch)
  const pull = useStore((s) => s.pull)
  const push = useStore((s) => s.push)
  const cancelOp = useStore((s) => s.cancelOp)
  const refreshAnalysis = useStore((s) => s.refreshAnalysis)

  const byPath = useMemo(() => new Map(snapshot.files.map((f) => [f.path, f])), [snapshot])
  const totalLoc = useMemo(() => snapshot.files.reduce((a, f) => a + f.loc, 0), [snapshot])

  const hotkeys = useMemo(
    () => ({
      c: () => useStore.getState().setPanel('changes'),
      b: () => useStore.getState().setPanel('branches'),
      s: () => useStore.getState().setPanel('stashes'),
      g: () => useStore.getState().setGraphOpen(!useStore.getState().graphOpen),
      '/': () => useStore.getState().setSearchOpen(true),
      space: () => {
        const st = useStore.getState()
        st.setPlaying(!st.playing)
      },
      escape: () => {
        const st = useStore.getState()
        st.setSearchOpen(false)
        st.setPanel('none')
        st.setDiffOpen(false)
        st.setFileView('none')
        st.setGraphOpen(false)
        st.setSelected(null)
      }
    }),
    []
  )
  useHotkeys(hotkeys)

  const last = analysis.snapshots.length - 1
  const hoveredFile = hovered ? byPath.get(hovered) : undefined
  const selectedFile = selected ? byPath.get(selected) : undefined

  const st = workingStatus
  const busy = opInProgress !== null
  const branchLabel = st ? (st.branch ?? `detached @ ${st.detachedAt}`) : analysis.info.branch
  const changeCount = st?.files.length ?? 0
  const hasRemote = (st?.remotes.length ?? 0) > 0
  const hasUpstream = st?.upstream != null
  const opState = st?.opState ?? 'none'

  return (
    <>
      <div className="hud-top">
        <span className="repo-name">{analysis.info.name}</span>
        <button
          className={panel === 'branches' ? 'active' : ''}
          onClick={() => setPanel('branches')}
          title="Branches"
        >
          ⑂ {branchLabel}
        </button>

        {hasRemote && (
          <span className="sync-group">
            <button disabled={busy} onClick={() => void fetch()} title="Fetch">
              ⭳ Fetch
            </button>
            <button disabled={busy || !hasUpstream} onClick={() => void pull()} title="Pull">
              ↓ Pull
            </button>
            <button
              disabled={busy}
              onClick={() => void push(!hasUpstream)}
              title={hasUpstream ? 'Push' : 'Publish this branch'}
            >
              ↑ {hasUpstream ? 'Push' : 'Publish'}
            </button>
            {st && <AheadBehind ahead={st.ahead} behind={st.behind} />}
          </span>
        )}

        {opState !== 'none' && (
          <span className="op-badge">
            {opState.toUpperCase()}
            {st?.rebaseProgress && ` ${st.rebaseProgress.done}/${st.rebaseProgress.total}`}
          </span>
        )}

        <button
          className={panel === 'changes' ? 'active' : ''}
          onClick={() => setPanel('changes')}
          title="Working tree changes"
        >
          ✎ Changes{changeCount > 0 ? ` (${changeCount})` : ''}
        </button>
        <button
          className={panel === 'stashes' ? 'active' : ''}
          onClick={() => setPanel('stashes')}
          title="Stashes"
        >
          ⊟ Stash{st && st.stashCount > 0 ? ` (${st.stashCount})` : ''}
        </button>
        <button
          className={graphOpen ? 'active' : ''}
          onClick={() => setGraphOpen(!graphOpen)}
          title="Commit graph (G)"
        >
          ⑃ Graph
        </button>
        <button onClick={() => useStore.getState().setSearchOpen(true)} title="Find a file (/)">
          ⌕
        </button>

        <div className="spacer" />

        {busy && (
          <span className="op-spinner">
            <span className="spinner" /> {opInProgress?.label}
            <button onClick={() => void cancelOp()}>Cancel</button>
          </span>
        )}
        {!busy && reanalyzing && (
          <span className="op-spinner">
            <span className="spinner" /> updating history…
          </span>
        )}
        {historyStale && !busy && !reanalyzing && (
          <button className="stale-pill" onClick={() => void refreshAnalysis()}>
            History changed — Reload
          </button>
        )}

        <ColorModePicker colorMode={colorMode} setColorMode={setColorMode} />
        <ThemePicker themeId={themeId} setTheme={setTheme} />
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
            <span>{formatDate(selectedFile.lastTouched)}</span>
          </div>
          <div className="row">
            <span>Last author</span>
            <span>{selectedFile.lastAuthor}</span>
          </div>
          <div className="details-actions">
            <button onClick={() => useStore.getState().setDiffOpen(true)}>⌗ Diff</button>
            <button onClick={() => useStore.getState().setFileView('history')}>◷ History</button>
            <button onClick={() => useStore.getState().setFileView('blame')}>◨ Blame</button>
          </div>
        </div>
      )}

      <SearchBox model={model} />
      <Legend model={model} snapshot={snapshot} />

      <div className="hud-bottom">
        <div className="commit-info">
          <span className="hash">{snapshot.hash.slice(0, 7)}</span>
          <span className="msg" title={snapshot.message}>
            {snapshot.message}
          </span>
          <span>
            {snapshot.author} · {formatDate(snapshot.date)} · commit {snapshot.index + 1} of{' '}
            {analysis.info.commitCount.toLocaleString()}
          </span>
          {snapshotIndex < last && st?.branch && (
            <button
              className="cherry-btn"
              disabled={busy}
              onClick={() =>
                useStore.getState().askConfirm({
                  title: 'Cherry-pick this commit?',
                  body: `Apply commit ${snapshot.hash.slice(0, 7)} "${snapshot.message}" onto ${st.branch}.`,
                  confirmLabel: 'Cherry-pick',
                  danger: false,
                  onConfirm: () => void useStore.getState().cherryPick(snapshot.hash)
                })
              }
            >
              ⤷ Cherry-pick onto {st.branch}
            </button>
          )}
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

function ColorModePicker({
  colorMode,
  setColorMode
}: {
  colorMode: ColorMode
  setColorMode: (m: ColorMode) => void
}): React.JSX.Element {
  const active = COLOR_MODES.find((m) => m.id === colorMode) ?? COLOR_MODES[0]
  return (
    <Picker
      buttonLabel={<>◑ {active.name}</>}
      title="Color the city by…"
      items={COLOR_MODES.map((m) => ({ id: m.id, label: m.name, hint: m.hint }))}
      activeId={colorMode}
      onPick={(id) => setColorMode(id as ColorMode)}
    />
  )
}

function ThemePicker({
  themeId,
  setTheme
}: {
  themeId: string
  setTheme: (id: string) => void
}): React.JSX.Element {
  const active = getTheme(themeId)
  return (
    <Picker
      buttonLabel={
        <>
          {active.glyph} {active.name}
        </>
      }
      title="Theme"
      items={THEMES.map((t) => ({
        id: t.id,
        label: (
          <>
            <span className="theme-glyph">{t.glyph}</span> {t.name}
          </>
        )
      }))}
      activeId={themeId}
      onPick={setTheme}
    />
  )
}
