import { useStore } from '../store'
import { THEMES } from '../city/themes'
import { MODES } from '../city/modes'

/**
 * One home for every persisted preference. Most are also reachable from the top
 * bar, but this panel is the canonical, discoverable place — and hosts the few
 * that live nowhere else (reduce motion, the diff default, reset-all). Every
 * control writes straight through to the store, which persists to localStorage.
 */
export default function SettingsPanel(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)

  const themeId = useStore((s) => s.themeId)
  const setTheme = useStore((s) => s.setTheme)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const timeOfDay = useStore((s) => s.timeOfDay)
  const setTimeOfDay = useStore((s) => s.setTimeOfDay)
  const sunFollowsCommit = useStore((s) => s.sunFollowsCommit)
  const toggleSunFollowsCommit = useStore((s) => s.toggleSunFollowsCommit)
  const reduceMotion = useStore((s) => s.reduceMotion)
  const toggleReduceMotion = useStore((s) => s.toggleReduceMotion)
  const showHotspots = useStore((s) => s.showHotspots)
  const toggleHotspots = useStore((s) => s.toggleHotspots)
  const diffSplit = useStore((s) => s.diffSplit)
  const toggleDiffSplit = useStore((s) => s.toggleDiffSplit)

  const recentCount = useStore((s) => s.recentRepos.length)
  const clearRecent = useStore((s) => s.clearRecent)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const resetPreferences = useStore((s) => s.resetPreferences)
  const askConfirm = useStore((s) => s.askConfirm)
  const checkForUpdate = useStore((s) => s.checkForUpdate)
  const update = useStore((s) => s.update)
  const updateCheck = useStore((s) => s.updateCheck)

  if (!open) return null

  const confirmReset = (): void => {
    askConfirm({
      title: 'Reset all preferences?',
      body: 'Theme, view, time of day, motion, diff layout and the first-run guide return to defaults. Your repositories and history are untouched.',
      confirmLabel: 'Reset',
      danger: true,
      onConfirm: () => resetPreferences()
    })
  }

  return (
    <div className="side-panel settings-panel">
      <div className="panel-head">
        <span>Settings</span>
        <button className="close" aria-label="Close" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        <section className="settings-section">
          <div className="section-head">
            <span>Appearance</span>
          </div>

          <label className="settings-row">
            <span>Theme</span>
            <select value={themeId} onChange={(e) => setTheme(e.target.value)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <div className="settings-row">
            <span>View</span>
            <div className="seg">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={viewMode === m.id ? 'active' : ''}
                  onClick={() => setViewMode(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <label className="settings-row toggle">
            <span>
              Sky follows commit time
              <small>A morning commit gets morning light</small>
            </span>
            <input type="checkbox" checked={sunFollowsCommit} onChange={toggleSunFollowsCommit} />
          </label>

          <label className="settings-row">
            <span>
              Time of day{sunFollowsCommit && <small>Manual — turns off the tracking above</small>}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(Number(e.target.value))}
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="section-head">
            <span>Scene &amp; motion</span>
          </div>

          <label className="settings-row toggle">
            <span>
              Reduce motion
              <small>No intro orbit, no traffic, no wandering livestock</small>
            </span>
            <input type="checkbox" checked={reduceMotion} onChange={toggleReduceMotion} />
          </label>

          <label className="settings-row toggle">
            <span>
              Activity hotspots
              <small>Pulse the files churning most this week</small>
            </span>
            <input type="checkbox" checked={showHotspots} onChange={toggleHotspots} />
          </label>
        </section>

        <section className="settings-section">
          <div className="section-head">
            <span>Diff</span>
          </div>
          <div className="settings-row">
            <span>Default layout</span>
            <div className="seg">
              <button
                className={!diffSplit ? 'active' : ''}
                onClick={() => diffSplit && toggleDiffSplit()}
              >
                Unified
              </button>
              <button
                className={diffSplit ? 'active' : ''}
                onClick={() => !diffSplit && toggleDiffSplit()}
              >
                Split
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-head">
            <span>Data</span>
          </div>
          <button
            className="settings-action"
            onClick={() => {
              setHelpOpen(true)
              setOpen(false)
            }}
          >
            Show the first-run guide
          </button>
          <button className="settings-action" disabled={recentCount === 0} onClick={clearRecent}>
            Clear recent repositories{recentCount > 0 ? ` (${recentCount})` : ''}
          </button>
          {/* The result is worded honestly rather than claiming "up to date":
              the main process treats offline, rate-limited and current
              identically, so we genuinely do not know which it was (#26). */}
          <button
            className="settings-action"
            disabled={updateCheck === 'checking'}
            onClick={() => void checkForUpdate(true)}
          >
            {update
              ? `Update available — ${update.version}`
              : updateCheck === 'checking'
                ? 'Checking…'
                : updateCheck === 'checked'
                  ? 'No update found — you are on the latest version, or GitHub was unreachable'
                  : 'Check for updates'}
          </button>
          <button className="settings-action danger" onClick={confirmReset}>
            Reset all preferences
          </button>
        </section>
      </div>
    </div>
  )
}
