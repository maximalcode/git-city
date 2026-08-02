import { useStore } from '../store'

/**
 * The keys that work on every screen with a repository open.
 *
 * They drive only the working-tree panels — Changes, Stash, Branches, Settings
 * — which the scene and the empty-repo screen both mount. Everything else (the
 * graph, the reflog, pull requests, find, playback) needs a history to point
 * at, so the HUD binds those on top of this map.
 *
 * Shared rather than copied because the empty-repo screen bound nothing at all
 * while its own copy told the user to press C and its rail advertised a hotkey
 * on every button (#27). One map means the two cannot drift again.
 */
export const REPO_HOTKEYS: Record<string, () => void> = {
  c: () => useStore.getState().setPanel('changes'),
  b: () => useStore.getState().setPanel('branches'),
  s: () => useStore.getState().setPanel('stashes'),
  ',': () => useStore.getState().setSettingsOpen(!useStore.getState().settingsOpen),
  // Escape means "put everything away", so it closes the lot regardless of
  // which screen is up — closing what was never open is a no-op.
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
}
