import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import Icon, { type IconName } from '../lib/icons'

/**
 * Left tool rail: every git panel/tool the top bar used to cram into one row,
 * grouped by job — working tree, then history & branches, then find. Each item
 * shows an icon, a short label and its active state; hover reveals the hotkey.
 */
export default function SideRail(): JSX.Element {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const graphOpen = useStore((s) => s.graphOpen)
  const setGraphOpen = useStore((s) => s.setGraphOpen)
  const reflogOpen = useStore((s) => s.reflogOpen)
  const setReflogOpen = useStore((s) => s.setReflogOpen)
  const setSearchOpen = useStore((s) => s.setSearchOpen)
  const prPanelOpen = useStore((s) => s.prPanelOpen)
  const setPrPanelOpen = useStore((s) => s.setPrPanelOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const workingStatus = useStore((s) => s.workingStatus)

  const changeCount = workingStatus?.files.length ?? 0
  const stashCount = workingStatus?.stashCount ?? 0

  return (
    <nav className="side-rail" aria-label="Git tools">
      <div className="rail-group">
        <RailButton
          icon="changes"
          label="Changes"
          hotkey="C"
          active={panel === 'changes'}
          badge={changeCount}
          onClick={() => setPanel('changes')}
        />
        <RailButton
          icon="stash"
          label="Stash"
          hotkey="S"
          active={panel === 'stashes'}
          badge={stashCount}
          onClick={() => setPanel('stashes')}
        />
      </div>

      <div className="rail-divider" />

      <div className="rail-group">
        <RailButton
          icon="branch"
          label="Branches"
          hotkey="B"
          active={panel === 'branches'}
          onClick={() => setPanel('branches')}
        />
        <RailButton
          icon="graph"
          label="Graph"
          hotkey="G"
          active={graphOpen}
          onClick={() => setGraphOpen(!graphOpen)}
        />
        <RailButton
          icon="timeMachine"
          label="History"
          hotkey="U"
          active={reflogOpen}
          onClick={() => setReflogOpen(!reflogOpen)}
        />
        <RailButton
          icon="pr"
          label="PRs"
          hotkey="P"
          active={prPanelOpen}
          onClick={() => setPrPanelOpen(!prPanelOpen)}
        />
      </div>

      <div className="rail-divider" />

      <div className="rail-group">
        <RailButton icon="search" label="Find" hotkey="/" onClick={() => setSearchOpen(true)} />
        <RailButton
          icon="settings"
          label="Settings"
          hotkey=","
          active={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        />
      </div>
    </nav>
  )
}

function RailButton({
  icon,
  label,
  hotkey,
  active = false,
  badge = 0,
  onClick
}: {
  icon: IconName
  label: string
  hotkey: string
  active?: boolean
  badge?: number
  onClick: () => void
}): ReactNode {
  return (
    <button
      className={`rail-btn${active ? ' active' : ''}`}
      onClick={onClick}
      title={`${label} (${hotkey})`}
      aria-pressed={active}
    >
      {badge > 0 && <span className="rail-badge">{badge > 99 ? '99+' : badge}</span>}
      <Icon name={icon} size={20} />
      <span className="rail-label">{label}</span>
    </button>
  )
}
