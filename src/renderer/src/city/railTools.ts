import type { IconName } from '../lib/icons'

export type RailToolId =
  'changes' | 'stash' | 'branches' | 'graph' | 'history' | 'prs' | 'find' | 'settings'

export interface RailTool {
  id: RailToolId
  icon: IconName
  label: string
  /** shown in the tooltip — must be a key the screen actually binds */
  hotkey: string
  /**
   * Opens nothing until the repository has at least one commit. A fresh
   * `git init` has no graph, no reflog, no pull requests and no scene to
   * search, so these go inert rather than lighting up and doing nothing (#27).
   */
  needsHistory?: boolean
}

/**
 * The tool rail, in order, grouped by job: working tree, then history and
 * branches, then find and settings.
 *
 * Data rather than JSX so a test can hold it against the hotkey map — a button
 * advertising a key nobody binds is exactly the bug this came from.
 */
export const RAIL_GROUPS: readonly (readonly RailTool[])[] = [
  [
    { id: 'changes', icon: 'changes', label: 'Changes', hotkey: 'C' },
    { id: 'stash', icon: 'stash', label: 'Stash', hotkey: 'S' }
  ],
  [
    { id: 'branches', icon: 'branch', label: 'Branches', hotkey: 'B' },
    { id: 'graph', icon: 'graph', label: 'Graph', hotkey: 'G', needsHistory: true },
    { id: 'history', icon: 'timeMachine', label: 'History', hotkey: 'U', needsHistory: true },
    { id: 'prs', icon: 'pr', label: 'PRs', hotkey: 'P', needsHistory: true }
  ],
  [
    { id: 'find', icon: 'search', label: 'Find', hotkey: '/', needsHistory: true },
    { id: 'settings', icon: 'settings', label: 'Settings', hotkey: ',' }
  ]
]

/** Every tool, flattened — the groups only matter to the renderer. */
export const RAIL_TOOLS: readonly RailTool[] = RAIL_GROUPS.flat()
