import { Fragment, type JSX, type ReactNode } from 'react'
import { useStore } from '../store'
import Icon, { type IconName } from '../lib/icons'
import { RAIL_GROUPS, type RailToolId } from './railTools'

/** What the rail knows about one tool beyond its label and icon. */
interface ToolState {
  active?: boolean
  badge?: number
  onClick: () => void
}

/**
 * Left tool rail: every git panel/tool the top bar used to cram into one row,
 * grouped by job — working tree, then history & branches, then find. Each item
 * shows an icon, a short label and its active state; hover reveals the hotkey.
 *
 * `hasHistory` is false on a repository with no commits, where the tools that
 * need a history go dim and inert instead of lighting up and opening nothing.
 */
export default function SideRail({ hasHistory = true }: { hasHistory?: boolean }): JSX.Element {
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

  const state: Record<RailToolId, ToolState> = {
    changes: {
      active: panel === 'changes',
      badge: changeCount,
      onClick: () => setPanel('changes')
    },
    stash: { active: panel === 'stashes', badge: stashCount, onClick: () => setPanel('stashes') },
    branches: { active: panel === 'branches', onClick: () => setPanel('branches') },
    graph: { active: graphOpen, onClick: () => setGraphOpen(!graphOpen) },
    history: { active: reflogOpen, onClick: () => setReflogOpen(!reflogOpen) },
    prs: { active: prPanelOpen, onClick: () => setPrPanelOpen(!prPanelOpen) },
    // Find opens a box rather than toggling a panel, so it has no active state
    find: { onClick: () => setSearchOpen(true) },
    settings: { active: settingsOpen, onClick: () => setSettingsOpen(!settingsOpen) }
  }

  return (
    <nav className="side-rail" aria-label="Git tools">
      {RAIL_GROUPS.map((group, g) => (
        <Fragment key={group[0].id}>
          {g > 0 && <div className="rail-divider" />}
          <div className="rail-group">
            {group.map((tool) => (
              <RailButton
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                hotkey={tool.hotkey}
                off={tool.needsHistory === true && !hasHistory}
                {...state[tool.id]}
              />
            ))}
          </div>
        </Fragment>
      ))}
    </nav>
  )
}

function RailButton({
  icon,
  label,
  hotkey,
  active = false,
  badge = 0,
  off = false,
  onClick
}: {
  icon: IconName
  label: string
  hotkey: string
  active?: boolean
  badge?: number
  off?: boolean
  onClick: () => void
}): ReactNode {
  // `aria-disabled` rather than `disabled`: a disabled button gets no pointer
  // events in Chrome, which would swallow the very tooltip that explains why
  // it is off.
  return (
    <button
      className={`rail-btn${active && !off ? ' active' : ''}${off ? ' off' : ''}`}
      onClick={off ? undefined : onClick}
      title={off ? `${label} — needs at least one commit` : `${label} (${hotkey})`}
      aria-disabled={off}
      aria-pressed={active && !off}
    >
      {badge > 0 && !off && <span className="rail-badge">{badge > 99 ? '99+' : badge}</span>}
      <Icon name={icon} size={20} />
      <span className="rail-label">{label}</span>
    </button>
  )
}
