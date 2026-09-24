import { useEffect, useRef, useState } from 'react'
import type { RehearsalMode as Mode } from '../../../shared/types'
import { useStore } from '../store'

export default function RehearsalMode(): React.JSX.Element | null {
  const repo = useStore((s) => s.repoPath)
  const setting = useStore((s) => s.rehearsalModeSetting)
  const error = useStore((s) => s.rehearsalModeError)
  const refresh = useStore((s) => s.refreshRehearsalMode)
  const busy = useStore((s) => s.rehearsalBusy || s.rehearsalRouting || !!s.opInProgress)
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const select = useRef<HTMLSelectElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const needsChoice = setting?.mode === null
  useEffect(() => {
    void refresh()
    const update = (): void => {
      void refresh()
    }
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [repo, refresh])
  useEffect(() => {
    if (needsChoice) {
      returnFocus.current = document.activeElement as HTMLElement
      dialog.current?.showModal()
      first.current?.focus()
    } else if (dialog.current?.open) {
      dialog.current.close()
      if (returnFocus.current?.isConnected && returnFocus.current !== document.body)
        returnFocus.current.focus()
      else select.current?.focus()
    }
  }, [needsChoice])
  if (!import.meta.env.DEV || !repo || (!setting && !error)) return null
  const choose = async (mode: Mode): Promise<void> => {
    setSaving(true)
    await refresh(mode)
    setSaving(false)
  }
  const explanation =
    'Shared by all worktrees. Automatic rehearses Merge, Rebase and Cherry-pick. Ask provides a manual Rehearse entry. Off runs direct actions. Pull is not rehearsed. Recovery locks always apply.'
  return (
    <section
      className="rehearsal-mode"
      aria-label="Rehearse mode"
      onKeyDown={(event) => event.stopPropagation()}
    >
      {error && <p role="alert">⚠ Could not load or save Rehearse mode: {error}</p>}
      <label>
        Rehearse mode (internal)
        <select
          ref={select}
          value={setting?.mode ?? ''}
          disabled={busy || saving || !setting}
          onChange={(event) => void choose(event.target.value as Mode)}
          aria-describedby="rehearsal-mode-help"
        >
          <option value="" disabled>
            Choose a mode
          </option>
          <option value="automatic">Automatic</option>
          <option value="ask">Ask</option>
          <option value="off">Off</option>
        </select>
      </label>
      <details>
        <summary>About modes</summary>
        <p id="rehearsal-mode-help">{explanation}</p>
      </details>
      {error && <button onClick={() => void refresh()}>Retry mode settings</button>}
      <dialog
        ref={dialog}
        className="rehearsal-dialog"
        aria-labelledby="rehearsal-mode-title"
        onCancel={() => {
          /* Escape defers the choice; supported actions remain blocked. */
        }}
      >
        <h2 id="rehearsal-mode-title">Choose a Rehearse mode</h2>
        <p>
          This repository was already known to Git City. Choose how supported actions should run.
        </p>
        <p>{explanation}</p>
        {(['automatic', 'ask', 'off'] as const).map((mode, index) => (
          <button
            key={mode}
            ref={index === 0 ? first : undefined}
            disabled={busy || saving}
            onClick={() => void choose(mode)}
          >
            {mode === 'automatic' ? 'Automatic' : mode === 'ask' ? 'Ask' : 'Off'}
          </button>
        ))}
      </dialog>
    </section>
  )
}
