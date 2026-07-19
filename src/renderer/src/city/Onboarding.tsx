import { useStore } from '../store'
import { COLOR_MODES } from './colorModes'
import Icon from '../lib/icons'

/**
 * First-run "what am I looking at?" guide. Explains the scene's visual encoding
 * (what size, colour and shape mean) so the 3D view isn't a mystery. Shows once
 * automatically, then only when re-opened from the "?" button; the dismissal is
 * remembered across sessions. Content follows the active view and colour mode.
 */
export default function Onboarding(): React.JSX.Element | null {
  const onboarded = useStore((s) => s.onboarded)
  const helpOpen = useStore((s) => s.helpOpen)
  const dismiss = useStore((s) => s.dismissOnboarding)
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  const viewMode = useStore((s) => s.viewMode)
  const colorMode = useStore((s) => s.colorMode)

  const visible = helpOpen || !onboarded
  if (!visible) return null

  const colorName = COLOR_MODES.find((m) => m.id === colorMode)?.name ?? 'language'
  const isCity = viewMode === 'city'

  const close = (): void => {
    if (helpOpen) setHelpOpen(false)
    else dismiss()
  }

  const rows = isCity
    ? [
        {
          icon: 'city' as const,
          title: 'Buildings are files',
          body: 'Taller = more lines of code.'
        },
        {
          icon: 'branch' as const,
          title: 'Districts are folders',
          body: 'Nested plots mirror your directory tree.'
        },
        {
          icon: 'color' as const,
          title: `Colour = ${colorName.toLowerCase()}`,
          body: 'See the legend (bottom-right) for what each colour means.'
        },
        {
          icon: 'flame' as const,
          title: 'Glowing beacons are hotspots',
          body: 'The files changing most this week.'
        }
      ]
    : [
        {
          icon: 'forest' as const,
          title: 'Trees are files',
          body: 'Bigger canopy = more lines of code.'
        },
        {
          icon: 'branch' as const,
          title: 'Groves are folders',
          body: 'Each clearing gathers one directory’s files.'
        },
        {
          icon: 'color' as const,
          title: `Colour = ${colorName.toLowerCase()}`,
          body: 'See the legend (bottom-right) for what each colour means.'
        },
        {
          icon: 'flame' as const,
          title: 'Glowing beacons are hotspots',
          body: 'The files changing most this week.'
        }
      ]

  return (
    <div className="onboard-backdrop" onMouseDown={close}>
      <div className="onboard-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onboard-head">
          <h2>Reading the {isCity ? 'city' : 'forest'}</h2>
          <p>Your repository, rendered in 3D. Here’s the key:</p>
        </div>
        <div className="onboard-rows">
          {rows.map((r) => (
            <div key={r.title} className="onboard-row">
              <span className="onboard-icon">
                <Icon name={r.icon} size={18} />
              </span>
              <div>
                <div className="onboard-title">{r.title}</div>
                <div className="onboard-body">{r.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="onboard-foot">
          <span className="onboard-tip">
            Tip: press <kbd>Ctrl</kbd>+<kbd>K</kbd> for the command palette · <kbd>Space</kbd> plays
            history
          </span>
          <button className="primary" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
