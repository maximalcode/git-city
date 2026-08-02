import { useEffect, useMemo, useRef, useState } from 'react'
import { hasApi, useStore } from '../store'
import { fuzzyFilter } from '../lib/fuzzy'
import { formatDate } from '../lib/format'
import Icon, { type IconName } from '../lib/icons'
import { THEMES } from './themes'
import { COLOR_MODES } from './colorModes'
import { nextMode } from './modes'
import type { CommitHit, GrepHit } from '../../../shared/types'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon?: IconName
  run: () => void
}

/** A rendered palette row: a static command, a matched commit, or a code hit. */
type Result =
  | { kind: 'command'; cmd: Command }
  | { kind: 'commit'; hit: CommitHit }
  | { kind: 'grep'; hit: GrepHit }

const MAX_RESULTS = 12
const SEARCH_DEBOUNCE = 180

/**
 * Fuzzy command palette (Ctrl/Cmd-K). One box over everything the app can do —
 * plus two search modes chosen by a leading sigil:
 *   `@query`  → search commits (message / author / hash) across all refs
 *   `:query`  → search code in tracked files (git grep)
 * With no sigil it fuzzy-matches actions + files. Arrow keys move, Enter runs,
 * Escape closes.
 */
export default function CommandPalette({
  model
}: {
  model: { paths: string[] }
}): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const branches = useStore((s) => s.branches)
  const stashes = useStore((s) => s.stashes)
  const workingStatus = useStore((s) => s.workingStatus)
  const repoPath = useStore((s) => s.repoPath)
  const [q, setQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [hits, setHits] = useState<Result[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      setQ('')
      setHits([])
    }
  }, [open])

  // mode + search term derived from the leading sigil
  const mode: 'command' | 'commit' | 'grep' = q.startsWith('@')
    ? 'commit'
    : q.startsWith(':')
      ? 'grep'
      : 'command'
  const term = mode === 'command' ? q : q.slice(1).trim()

  const commands = useMemo<Command[]>(() => {
    const s = useStore.getState()
    const close = (): void => s.setPaletteOpen(false)
    const act = (fn: () => void) => (): void => {
      fn()
      close()
    }
    const list: Command[] = []

    const other = nextMode(s.viewMode)
    list.push({
      id: 'view',
      group: 'View',
      icon: other.icon,
      label: `Switch to ${other.name} view`,
      run: act(() => s.setViewMode(other.id))
    })
    list.push({
      id: 'play',
      group: 'Playback',
      icon: s.playing ? 'pause' : 'play',
      label: s.playing ? 'Pause history playback' : 'Play history',
      run: act(() => s.setPlaying(!s.playing))
    })

    const panelCmds: [string, string, IconName, () => void][] = [
      ['changes', 'Open Changes', 'changes', () => s.setPanel('changes')],
      ['branches', 'Open Branches', 'branch', () => s.setPanel('branches')],
      ['stashes', 'Open Stashes', 'stash', () => s.setPanel('stashes')],
      ['graph', 'Toggle Commit Graph', 'graph', () => s.setGraphOpen(!s.graphOpen)],
      ['history', 'Toggle History (undo log)', 'timeMachine', () => s.setReflogOpen(!s.reflogOpen)],
      ['prs', 'Pull Requests', 'pr', () => s.setPrPanelOpen(!s.prPanelOpen)]
    ]
    for (const [id, label, icon, fn] of panelCmds) {
      list.push({ id: `panel-${id}`, group: 'Tools', icon, label, run: act(fn) })
    }
    list.push({
      id: 'hotspots',
      group: 'Tools',
      icon: 'flame',
      label: s.showHotspots ? 'Hide activity hotspots' : 'Show activity hotspots',
      run: act(() => s.toggleHotspots())
    })

    if ((workingStatus?.remotes.length ?? 0) > 0) {
      list.push({
        id: 'fetch',
        group: 'Sync',
        icon: 'fetch',
        label: 'Fetch from remote',
        run: act(() => void s.fetch())
      })
      if (workingStatus?.upstream != null) {
        list.push({
          id: 'pull',
          group: 'Sync',
          icon: 'pull',
          label: 'Pull from upstream',
          run: act(() => void s.pull())
        })
        list.push({
          id: 'push',
          group: 'Sync',
          icon: 'push',
          label: 'Push to upstream',
          run: act(() => void s.push(false))
        })
      } else {
        list.push({
          id: 'publish',
          group: 'Sync',
          icon: 'push',
          label: 'Publish this branch',
          run: act(() => void s.push(true))
        })
      }
    }

    const times: [string, number][] = [
      ['Dawn', 0.25],
      ['Noon', 0.5],
      ['Dusk', 0.75],
      ['Night', 0.0]
    ]
    for (const [name, t] of times) {
      list.push({
        id: `time-${name}`,
        group: 'Time of day',
        icon: 'sun',
        label: `Set time: ${name}`,
        run: act(() => s.setTimeOfDay(t))
      })
    }
    for (const t of THEMES) {
      list.push({
        id: `theme-${t.id}`,
        group: 'Theme',
        icon: 'theme',
        label: `Theme: ${t.name}`,
        hint: t.glyph,
        run: act(() => s.setTheme(t.id))
      })
    }
    for (const m of COLOR_MODES) {
      list.push({
        id: `color-${m.id}`,
        group: 'Colour by',
        icon: 'color',
        label: `Colour by ${m.name}`,
        hint: m.hint,
        run: act(() => s.setColorMode(m.id))
      })
    }
    for (const b of branches) {
      if (b.isRemote || b.current) continue
      list.push({
        id: `branch-${b.name}`,
        group: 'Switch branch',
        icon: 'branch',
        label: `Switch to ${b.name}`,
        run: act(() => void s.switchBranch(b.name))
      })
    }
    for (const st of stashes) {
      list.push({
        id: `stash-${st.index}`,
        group: 'Stash',
        icon: 'stash',
        label: `Pop stash: ${st.message}`,
        run: act(() => void s.stashPop(st.index))
      })
    }
    list.push({
      id: 'open-repo',
      group: 'Repository',
      icon: 'open',
      label: 'Open another repository…',
      run: act(() => s.backToWelcome())
    })
    for (const p of model.paths) {
      list.push({
        id: `file-${p}`,
        group: 'Go to file',
        icon: 'search',
        label: p,
        run: act(() => s.setSelected(p))
      })
    }
    return list
  }, [model, branches, stashes, workingStatus])

  // async commit / code search (debounced), only in the sigil modes
  useEffect(() => {
    if (mode === 'command') {
      setHits([])
      setSearching(false)
      return
    }
    if (!hasApi() || !repoPath || term.length < 2) {
      setHits([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const id = setTimeout(() => {
      const run =
        mode === 'commit'
          ? window.gitCity
              .searchCommits(repoPath, term, 'auto')
              .then((r) => r.hits.map((hit): Result => ({ kind: 'commit', hit })))
          : window.gitCity
              .grepWorkingTree(repoPath, term)
              .then((r) => r.hits.map((hit): Result => ({ kind: 'grep', hit })))
      void run
        .then((rs) => {
          if (!cancelled) setHits(rs)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, SEARCH_DEBOUNCE)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [mode, term, repoPath])

  const results = useMemo<Result[]>(() => {
    if (mode === 'command') {
      return fuzzyFilter(q, commands, (c) => `${c.label} ${c.group}`, MAX_RESULTS).map((cmd) => ({
        kind: 'command' as const,
        cmd
      }))
    }
    return hits
  }, [mode, q, commands, hits])

  useEffect(() => setActiveIdx(0), [q, hits])
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, results])

  if (!open) return null

  const run = (r: Result | undefined): void => {
    if (!r) return
    const s = useStore.getState()
    if (r.kind === 'command') r.cmd.run()
    else if (r.kind === 'commit') s.openCommit(r.hit.hash)
    else {
      s.setSelected(r.hit.path)
      s.setPaletteOpen(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[activeIdx])
    }
  }

  const modeIcon: IconName = mode === 'commit' ? 'graph' : mode === 'grep' ? 'search' : 'command'
  const emptyMsg =
    mode === 'command'
      ? 'No matching command'
      : term.length < 2
        ? mode === 'commit'
          ? 'Type to search commits (message, author or hash)…'
          : 'Type to search code in tracked files…'
        : searching
          ? 'Searching…'
          : mode === 'commit'
            ? 'No matching commit'
            : 'No code match'

  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name={modeIcon} size={17} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command  ·  @ commits  ·  : code"
            aria-label="Command palette"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {mode !== 'command' && (
            <span className="palette-mode">{mode === 'commit' ? 'Commits' : 'Code'}</span>
          )}
        </div>
        <div className="palette-results" role="listbox" ref={listRef}>
          {results.map((r, i) => (
            <PaletteRow
              key={rowKey(r, i)}
              result={r}
              active={i === activeIdx}
              onClick={() => run(r)}
              onHover={() => setActiveIdx(i)}
            />
          ))}
          {results.length === 0 && <div className="palette-empty">{emptyMsg}</div>}
        </div>
      </div>
    </div>
  )
}

function rowKey(r: Result, i: number): string {
  if (r.kind === 'command') return r.cmd.id
  if (r.kind === 'commit') return `c${r.hit.hash}`
  return `g${r.hit.path}:${r.hit.line}:${i}`
}

function PaletteRow({
  result,
  active,
  onClick,
  onHover
}: {
  result: Result
  active: boolean
  onClick: () => void
  onHover: () => void
}): React.JSX.Element {
  if (result.kind === 'commit') {
    const h = result.hit
    return (
      <button
        role="option"
        aria-selected={active}
        className={active ? 'active' : ''}
        onClick={onClick}
        onMouseEnter={onHover}
        title={h.subject}
      >
        <Icon name="graph" size={15} />
        <span className="palette-label">{h.subject}</span>
        <span className="palette-hash">{h.shortHash}</span>
        <span className="palette-group">
          {h.author} · {formatDate(h.date)}
        </span>
      </button>
    )
  }
  if (result.kind === 'grep') {
    const h = result.hit
    return (
      <button
        role="option"
        aria-selected={active}
        className={active ? 'active' : ''}
        onClick={onClick}
        onMouseEnter={onHover}
        title={`${h.path}:${h.line}`}
      >
        <Icon name="search" size={15} />
        <span className="palette-label palette-code">{h.text.trim()}</span>
        <span className="palette-group">
          {h.path}:{h.line}
        </span>
      </button>
    )
  }
  const c = result.cmd
  return (
    <button
      role="option"
      aria-selected={active}
      className={active ? 'active' : ''}
      onClick={onClick}
      onMouseEnter={onHover}
      title={c.label}
    >
      {c.icon && <Icon name={c.icon} size={15} />}
      <span className="palette-label">{c.label}</span>
      <span className="palette-group">{c.group}</span>
    </button>
  )
}
