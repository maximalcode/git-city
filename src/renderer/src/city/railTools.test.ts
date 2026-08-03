import { describe, expect, it } from 'vitest'
import { REPO_HOTKEYS } from '../lib/repoHotkeys'
import { useStore } from '../store'
import { RAIL_GROUPS, RAIL_TOOLS } from './railTools'

describe('rail tools', () => {
  it('has a unique id per tool', () => {
    const ids = RAIL_TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gates exactly the tools that need a commit to open anything', () => {
    // graph, reflog, pull requests and find all read a history; a fresh
    // `git init` has none, so these go inert on the empty-repo screen
    const gated = RAIL_TOOLS.filter((t) => t.needsHistory).map((t) => t.id)
    expect(gated).toEqual(['graph', 'history', 'prs', 'find'])
  })

  it('only advertises hotkeys that work where the tool is live', () => {
    // The empty-repo screen binds REPO_HOTKEYS and nothing else. Any tool it
    // leaves live therefore has to name a key in that map, or its tooltip is
    // promising something the screen cannot do — the bug behind #27.
    for (const tool of RAIL_TOOLS) {
      if (tool.needsHistory) continue
      expect(REPO_HOTKEYS).toHaveProperty(tool.hotkey.toLowerCase())
    }
  })

  it('keeps every group non-empty', () => {
    // the renderer keys each group on its first tool and draws a divider
    // between groups; an empty one would throw
    for (const group of RAIL_GROUPS) expect(group.length).toBeGreaterThan(0)
  })
})

describe('REPO_HOTKEYS', () => {
  it('toggles the working-tree panels', () => {
    REPO_HOTKEYS.c()
    expect(useStore.getState().panel).toBe('changes')
    REPO_HOTKEYS.b()
    expect(useStore.getState().panel).toBe('branches')
    REPO_HOTKEYS.s()
    expect(useStore.getState().panel).toBe('stashes')
    // pressing the open panel's own key puts it away again
    REPO_HOTKEYS.s()
    expect(useStore.getState().panel).toBe('none')
  })

  it('toggles settings', () => {
    const before = useStore.getState().settingsOpen
    REPO_HOTKEYS[',']()
    expect(useStore.getState().settingsOpen).toBe(!before)
    REPO_HOTKEYS[',']()
    expect(useStore.getState().settingsOpen).toBe(before)
  })

  it('escape closes everything the empty-repo screen can open', () => {
    const st = useStore.getState()
    st.dismissOnboarding() // past first run: no guide in the way
    st.setPanel('changes')
    st.setSettingsOpen(true)
    st.setDiffOpen(true)

    REPO_HOTKEYS.escape()

    const after = useStore.getState()
    expect(after.panel).toBe('none')
    expect(after.settingsOpen).toBe(false)
    expect(after.diffOpen).toBe(false)
  })

  /**
   * The guide is a modal overlay over everything else, so Escape has to take it
   * off first and stop — tearing down the panels underneath an overlay the user
   * was only trying to close is not what they asked for (#30).
   */
  it('escape takes the guide off first, leaving what is behind it alone', () => {
    const st = useStore.getState()
    st.dismissOnboarding()
    st.setPanel('changes')
    st.setHelpOpen(true)

    REPO_HOTKEYS.escape()
    expect(useStore.getState().helpOpen).toBe(false)
    expect(useStore.getState().panel).toBe('changes')

    REPO_HOTKEYS.escape()
    expect(useStore.getState().panel).toBe('none')
  })

  it('escape dismisses the first-run guide, which no flag marks as open', () => {
    // it shows because `onboarded` is false, so clearing helpOpen did nothing
    // and Escape was a silent no-op in front of it (#30)
    useStore.setState({ onboarded: false, helpOpen: false })

    REPO_HOTKEYS.escape()

    expect(useStore.getState().onboarded).toBe(true)
  })
})
