/**
 * Small stroke-based SVG icon set, drawn in-code so the HUD reads with real
 * icons instead of cryptic Unicode glyphs (⑂ ⊟ ⑃ …). One <Icon name> component;
 * every icon inherits `currentColor` and sizes with the `size` prop.
 */
import type { JSX } from 'react'

export type IconName =
  | 'branch'
  | 'changes'
  | 'stash'
  | 'graph'
  | 'timeMachine'
  | 'undo'
  | 'search'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'city'
  | 'forest'
  | 'farm'
  | 'color'
  | 'theme'
  | 'open'
  | 'play'
  | 'pause'
  | 'chevron'
  | 'command'
  | 'sun'
  | 'flame'
  | 'help'
  | 'pr'
  | 'external'
  | 'settings'
  | 'record'

const PATHS: Record<IconName, JSX.Element> = {
  farm: (
    <>
      <path d="M3 20V10l6-4 6 4v10" />
      <path d="M3 10l6-4 6 4" />
      <path d="M7 20v-5h4v5" />
      <path d="M17 20v-8h4v8" />
      <path d="M17 12h4" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="8" r="2.4" />
      <path d="M6 8.4v7.2M8.4 8Q18 8 18 10.4" />
    </>
  ),
  changes: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  stash: (
    <>
      <rect x="3.5" y="7" width="17" height="12.5" rx="1.6" />
      <path d="M3.5 10.5h17M9.5 14h5M6 7l1.6-2.5h8.8L18 7" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="16" cy="12" r="2.2" />
      <path d="M6 8.2v7.6M8 6.6q8 .6 6.4 4.2M8 17.4q8-.6 6.4-4.2" />
    </>
  ),
  timeMachine: (
    <>
      <path d="M4.5 11a7.5 7.5 0 1 1 1.2 4.6" />
      <path d="M4.5 11V7M4.5 11H8.5M12 8.5V12l2.4 1.6" />
    </>
  ),
  undo: (
    <>
      <path d="M5 9h9a5 5 0 0 1 0 10H8" />
      <path d="M5 9l3.5-3.5M5 9l3.5 3.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  fetch: (
    <>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 4v7h-7" />
    </>
  ),
  pull: (
    <>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
    </>
  ),
  push: (
    <>
      <path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 5h14" />
    </>
  ),
  city: (
    <>
      <path d="M3 20h18M5 20V9l5-3v14M14 20V4l5 3v13" />
      <path d="M7.4 11h0M7.4 14h0M16.4 9h0M16.4 12h0" />
    </>
  ),
  forest: (
    <>
      <path d="M12 3.5 6.5 12h3L5 18.5h14L14.5 12h3L12 3.5Z" />
      <path d="M12 18.5V22" />
    </>
  ),
  color: (
    <>
      <path d="M12 3.5c3.5 4 6 6.7 6 9.6a6 6 0 0 1-12 0c0-2.9 2.5-5.6 6-9.6Z" />
    </>
  ),
  theme: (
    <>
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.4 6.4 0 0 0 20 14.5Z" />
    </>
  ),
  open: (
    <>
      <path d="M4 7.5h5l2 2h9V18a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18Z" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.8" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  command: (
    <path d="M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9m0 0h6m-6 0v6m6-6a2.5 2.5 0 1 0-2.5-2.5V9m2.5 6a2.5 2.5 0 1 0-2.5-2.5V15m-6 0a2.5 2.5 0 1 1 2.5 2.5V15" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12h2.5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
    </>
  ),
  flame: (
    <path d="M12 3.5c1.2 3 4.5 4.3 4.5 8.2A4.5 4.5 0 0 1 12 20a4.5 4.5 0 0 1-4.5-4.3c0-1.9 1.1-2.9 1.8-4.1.6 1 1.5 1.3 2 1.1-.7-2 .7-3.9.7-6.7Z" />
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.4 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.4 2-2.4 3.6" />
      <path d="M12 17h0" />
    </>
  ),
  pr: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M6 8.4v7.2M18 15.6V11a3 3 0 0 0-3-3h-4M13 6l-2 2 2 2" />
    </>
  ),
  external: (
    <>
      <path d="M14 5h5v5" />
      <path d="M19 5l-7 7" />
      <path d="M18 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7.5A1.5 1.5 0 0 1 6 6h4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5l2.6-1.5" />
    </>
  ),
  record: (
    <>
      <rect x="3.5" y="6" width="12" height="12" rx="2.5" />
      <path d="M15.5 10l5-3v10l-5-3z" />
    </>
  )
}

export default function Icon({
  name,
  size = 18,
  className,
  title
}: {
  name: IconName
  size?: number
  className?: string
  title?: string
}): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  )
}
