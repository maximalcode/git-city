import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { fuzzyFilter } from '../lib/fuzzy'
import Icon, { type IconName } from '../lib/icons'
import { THEMES } from './themes'
import { COLOR_MODES } from './colorModes'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  icon?: IconName
  run: () => void
}

const MAX_RESULTS = 12

/**
 * Fuzzy command palette (Ctrl/Cmd-K). One search box over everything the app can
 * do — switch view/theme/colour, open a panel, jump to any file (camera flies
 * there), switch a branch, pop a stash, sync. Actions come first so an empty
 * query shows the common ones; files (there can be hundreds) rank in by fuzzy
 * match. Arrow keys move, Enter runs, Escape closes.
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
  const [q, setQ] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      setQ('')
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const s = useStore.getState()
    const close = (): void => s.setPaletteOpen(false)
    const act = (fn: () => void) => (): void => {
      fn()
      close()
    }
    const list: Command[] = []

    // view
    const otherView = s.viewMode === 'city' ? 'forest' : 'city'
    list.push({
      id: 'view',
      group: 'View',
      icon: otherView === 'forest' ? 'forest' : 'city',
      label: `Switch to ${otherView === 'forest' ? 'Forest' : 'City'} view`,
      run: act(() => s.setViewMode(otherView))
    })

    // playback
    list.push({
      id: 'play',
      group: 'Playback',
      icon: s.playing ? 'pause' : 'play',
      label: s.playing ? 'Pause history playback' : 'Play history',
      run: act(() => s.setPlaying(!s.playing))
    })

    // panels & tools
    const panelCmds: [string, string, IconName, () => void][] = [
      ['changes', 'Open Changes', 'changes', () => s.setPanel('changes')],
      ['branches', 'Open Branches', 'branch', () => s.setPanel('branches')],
      ['stashes', 'Open Stashes', 'stash', () => s.setPanel('stashes')],
      ['graph', 'Toggle Commit Graph', 'graph', () => s.setGraphOpen(!s.graphOpen)],
      ['history', 'Toggle History (undo log)', 'timeMachine', () => s.setReflogOpen(!s.reflogOpen)]
    ]
    for (const [id, label, icon, fn] of panelCmds) {
      list.push({ id: `panel-${id}`, group: 'Tools', icon, label, run: act(fn) })
    }

    // hotspots
    list.push({
      id: 'hotspots',
      group: 'Tools',
      icon: 'flame',
      label: s.showHotspots ? 'Hide activity hotspots' : 'Show activity hotspots',
      run: act(() => s.toggleHotspots())
    })

    // sync
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

    // time of day
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

    // theme
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

    // color mode
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

    // branches (local, switch-able)
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

    // stashes
    for (const st of stashes) {
      list.push({
        id: `stash-${st.index}`,
        group: 'Stash',
        icon: 'stash',
        label: `Pop stash: ${st.message}`,
        run: act(() => void s.stashPop(st.index))
      })
    }

    // repo
    list.push({
      id: 'open-repo',
      group: 'Repository',
      icon: 'open',
      label: 'Open another repository…',
      run: act(() => s.backToWelcome())
    })

    // files last — the long list, surfaced by fuzzy match
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

  const results = useMemo(
    () => fuzzyFilter(q, commands, (c) => `${c.label} ${c.group}`, MAX_RESULTS),
    [q, commands]
  )

  useEffect(() => setActiveIdx(0), [q])
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, results])

  if (!open) return null

  const run = (c: Command | undefined): void => {
    if (c) c.run()
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

  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="command" size={17} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or file…"
            aria-label="Command palette"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="palette-results" role="listbox" ref={listRef}>
          {results.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === activeIdx}
              className={i === activeIdx ? 'active' : ''}
              onClick={() => run(c)}
              onMouseEnter={() => setActiveIdx(i)}
              title={c.label}
            >
              {c.icon && <Icon name={c.icon} size={15} />}
              <span className="palette-label">{c.label}</span>
              <span className="palette-group">{c.group}</span>
            </button>
          ))}
          {results.length === 0 && <div className="palette-empty">No matching command</div>}
        </div>
      </div>
    </div>
  )
}
