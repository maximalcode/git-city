import { useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot } from '../../../shared/types'
import { languageOf } from '../lib/languages'
import { useHotkeys } from '../lib/useHotkeys'
import { AheadBehind, formatDate } from '../lib/format'
import Picker from '../lib/Picker'
import Icon from '../lib/icons'
import { useStore, type ColorMode, type ViewMode } from '../store'
import { THEMES, getTheme } from './themes'
import { COLOR_MODES, type ColorContext } from './colorModes'
import Legend from './Legend'
import SearchBox from './SearchBox'
import SideRail from './SideRail'

/** The slice of a scene model the HUD needs — CityModel and ForestModel both satisfy it. */
export type HudModel = ColorContext & { paths: string[] }

interface Props {
  snapshot: Snapshot
  model: HudModel
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
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
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
  const undoLast = useStore((s) => s.undoLast)
  const fetch = useStore((s) => s.fetch)
  const pull = useStore((s) => s.pull)
  const push = useStore((s) => s.push)
  const cancelOp = useStore((s) => s.cancelOp)
  const refreshAnalysis = useStore((s) => s.refreshAnalysis)
  const timeOfDay = useStore((s) => s.timeOfDay)
  const setTimeOfDay = useStore((s) => s.setTimeOfDay)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const startExport = useStore((s) => s.startExport)
  const exporting = useStore((s) => s.exporting)
  const modalOpen = useStore((s) => s.confirm !== null || s.mergeView !== null)

  const byPath = useMemo(() => new Map(snapshot.files.map((f) => [f.path, f])), [snapshot])

  // Ctrl/Cmd-K toggles the command palette. Handled outside useHotkeys because
  // that hook deliberately ignores modifier combos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const st = useStore.getState()
        st.setPaletteOpen(!st.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // hover tooltip follows the cursor; positioned imperatively so pointer moves
  // don't re-render the HUD
  const tooltipRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const el = tooltipRef.current
      if (!el) return
      const pad = 14
      const w = el.offsetWidth
      const h = el.offsetHeight
      let x = e.clientX + 18
      let y = e.clientY + 18
      if (x + w + pad > window.innerWidth) x = e.clientX - w - 18
      if (y + h + pad > window.innerHeight) y = e.clientY - h - 18
      el.style.left = `${Math.max(pad, x)}px`
      el.style.top = `${Math.max(pad, y)}px`
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const hotkeys = useMemo(
    () => ({
      c: () => useStore.getState().setPanel('changes'),
      b: () => useStore.getState().setPanel('branches'),
      s: () => useStore.getState().setPanel('stashes'),
      g: () => useStore.getState().setGraphOpen(!useStore.getState().graphOpen),
      u: () => useStore.getState().setReflogOpen(!useStore.getState().reflogOpen),
      p: () => useStore.getState().setPrPanelOpen(!useStore.getState().prPanelOpen),
      ',': () => useStore.getState().setSettingsOpen(!useStore.getState().settingsOpen),
      v: () => {
        const st = useStore.getState()
        st.setViewMode(st.viewMode === 'city' ? 'forest' : 'city')
      },
      '/': () => useStore.getState().setSearchOpen(true),
      space: () => {
        const st = useStore.getState()
        st.setPlaying(!st.playing)
      },
      escape: () => {
        const st = useStore.getState()
        st.setPaletteOpen(false)
        st.setHelpOpen(false)
        st.setSearchOpen(false)
        st.setPrPanelOpen(false)
        st.setSettingsOpen(false)
        st.clearReview()
        st.setPanel('none')
        st.setDiffOpen(false)
        st.setFileView('none')
        st.setGraphOpen(false)
        st.setRebaseOpen(false)
        st.setReflogOpen(false)
        st.setSelected(null)
      }
    }),
    []
  )
  // suspended while the confirm dialog or merge view is up — 'c'/'space'/etc.
  // must not toggle panels or playback underneath a modal
  useHotkeys(hotkeys, !modalOpen)

  const last = analysis.snapshots.length - 1
  const hoveredFile = hovered ? byPath.get(hovered) : undefined
  const selectedFile = selected ? byPath.get(selected) : undefined

  const st = workingStatus
  const busy = opInProgress !== null
  const branchLabel = st ? (st.branch ?? `detached @ ${st.detachedAt}`) : analysis.info.branch
  const hasRemote = (st?.remotes.length ?? 0) > 0
  const hasUpstream = st?.upstream != null
  const opState = st?.opState ?? 'none'

  return (
    <>
      <SideRail />

      <div className="hud-top">
        <div className="hud-zone hud-left">
          <span className="repo-name">{analysis.info.name}</span>
          <button
            className={`branch-chip${panel === 'branches' ? ' active' : ''}`}
            onClick={() => setPanel('branches')}
            title="Current branch — click for branches (B)"
          >
            <Icon name="branch" size={15} />
            {branchLabel}
          </button>
          <button
            className="icon-btn"
            disabled={busy}
            onClick={() => void undoLast()}
            title="Undo the last HEAD move — keeps your changes, itself undoable"
            aria-label="Undo last change"
          >
            <Icon name="undo" size={16} />
          </button>
          {opState !== 'none' && (
            <span className="op-badge">
              {opState.toUpperCase()}
              {st?.rebaseProgress && ` ${st.rebaseProgress.done}/${st.rebaseProgress.total}`}
            </span>
          )}
        </div>

        <div className="hud-zone hud-center">
          {hasRemote && (
            <span className="sync-segment">
              <button disabled={busy} onClick={() => void fetch()} title="Fetch">
                <Icon name="fetch" size={15} />
                Fetch
              </button>
              <button disabled={busy || !hasUpstream} onClick={() => void pull()} title="Pull">
                <Icon name="pull" size={15} />
                Pull
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void push(!hasUpstream)}
                title={hasUpstream ? 'Push' : 'Publish this branch'}
              >
                <Icon name="push" size={15} />
                {hasUpstream ? 'Push' : 'Publish'}
              </button>
            </span>
          )}
          {hasRemote && st && <AheadBehind ahead={st.ahead} behind={st.behind} />}
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
        </div>

        <div className="hud-zone hud-right">
          <ViewPicker viewMode={viewMode} setViewMode={setViewMode} />
          <ColorModePicker colorMode={colorMode} setColorMode={setColorMode} />
          <ThemePicker themeId={themeId} setTheme={setTheme} />
          <TimeOfDayControl timeOfDay={timeOfDay} setTimeOfDay={setTimeOfDay} />
          <button
            className="icon-btn"
            disabled={exporting}
            onClick={() => startExport()}
            title="Export a time-lapse video of the whole history"
            aria-label="Export a time-lapse video"
          >
            <Icon name="record" size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setHelpOpen(true)}
            title="What am I looking at? (encoding guide)"
            aria-label="Show the encoding guide"
          >
            <Icon name="help" size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={backToWelcome}
            title="Open another repository"
            aria-label="Open another repository"
          >
            <Icon name="open" size={16} />
          </button>
        </div>
      </div>

      {playing && (
        <div className="playhead">
          <span className="playhead-hash">{snapshot.hash.slice(0, 7)}</span>
          <span className="playhead-msg" title={snapshot.message}>
            {snapshot.message}
          </span>
          <span className="playhead-meta">
            {snapshot.author} · {formatDate(snapshot.date)} · commit {snapshot.index + 1}/
            {analysis.info.commitCount.toLocaleString()}
          </span>
        </div>
      )}

      {hoveredFile && hovered !== selected && (
        <div className="tooltip" ref={tooltipRef} style={{ left: -9999, top: -9999 }}>
          <div className="path">{hoveredFile.path}</div>
          <div className="meta">
            {languageOf(hoveredFile.path).name} · {hoveredFile.loc.toLocaleString()} lines ·{' '}
            {hoveredFile.commits} commit{hoveredFile.commits === 1 ? '' : 's'}
          </div>
          <div className="meta">
            {hoveredFile.lastAuthor} · {formatDate(hoveredFile.lastTouched)}
          </div>
          <div className="tooltip-hint">double-click to diff</div>
        </div>
      )}

      {selectedFile && (
        <div className="details">
          <button className="close" aria-label="Close" onClick={() => setSelected(null)}>
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
          <button
            className="play"
            onClick={() => setPlaying(!playing)}
            title="Play history (Space)"
            aria-label={playing ? 'Pause history' : 'Play history'}
          >
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

function timeLabel(t: number): string {
  if (t < 0.12 || t >= 0.9) return 'Night'
  if (t < 0.33) return 'Dawn'
  if (t < 0.6) return 'Midday'
  if (t < 0.8) return 'Dusk'
  return 'Evening'
}

/** Sun button that opens a little popover with a time-of-day slider. */
function TimeOfDayControl({
  timeOfDay,
  setTimeOfDay
}: {
  timeOfDay: number
  setTimeOfDay: (t: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="tod" ref={ref}>
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Time of day"
        aria-label="Time of day"
      >
        <Icon name="sun" size={16} />
      </button>
      {open && (
        <div className="tod-popover">
          <div className="tod-head">
            <Icon name="sun" size={14} />
            <span>{timeLabel(timeOfDay)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(Number(e.target.value))}
            aria-label="Time of day"
          />
          <div className="tod-ends">
            <span>Night</span>
            <span>Noon</span>
            <span>Night</span>
          </div>
        </div>
      )}
    </div>
  )
}

const VIEW_MODES: { id: ViewMode; glyph: string; name: string; hint: string }[] = [
  { id: 'city', glyph: '🏙', name: 'City', hint: 'Files as buildings in districts' },
  { id: 'forest', glyph: '🌲', name: 'Forest', hint: 'Files as trees in folder groves' }
]

function ViewPicker({
  viewMode,
  setViewMode
}: {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
}): React.JSX.Element {
  const active = VIEW_MODES.find((m) => m.id === viewMode) ?? VIEW_MODES[0]
  return (
    <Picker
      buttonLabel={
        <>
          {active.glyph} {active.name}
        </>
      }
      title="View (V)"
      items={VIEW_MODES.map((m) => ({
        id: m.id,
        label: (
          <>
            <span className="theme-glyph">{m.glyph}</span> {m.name}
          </>
        ),
        hint: m.hint
      }))}
      activeId={viewMode}
      onPick={(id) => setViewMode(id as ViewMode)}
    />
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
