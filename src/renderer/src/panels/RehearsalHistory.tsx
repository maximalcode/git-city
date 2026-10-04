import { useEffect, useRef, useState } from 'react'
import type { RehearsalEntry } from '../../../shared/types'
import { useStore } from '../store'
import { useRepoQuery } from '../lib/repoQuery'

function bytes(value: number | null): string {
  if (value === null) return 'unknown'
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}

export default function RehearsalHistory({ repo }: { repo: string }): React.JSX.Element {
  const inventory = useStore((s) => s.rehearsalInventories[repo])
  const current = useStore((s) => s.rehearsalCurrent[repo])
  const busy = useStore((s) => s.rehearsalBusy)
  const load = useStore((s) => s.loadRehearsals)
  const select = useStore((s) => s.selectRehearsal)
  const discard = useStore((s) => s.discardRehearsals)
  const [checked, setChecked] = useState<string[]>([])
  const [targets, setTargets] = useState<RehearsalEntry[] | null>(null)
  const confirmation = useRef<HTMLDialogElement>(null)
  const discardButton = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const selected =
    inventory?.entries.filter((entry) => checked.includes(entry.id) && !entry.active) ?? []

  const query = useRepoQuery([repo], (_api, [origin]) => load(origin))
  useEffect(() => {
    if (targets) {
      confirmation.current?.showModal()
      cancel.current?.focus()
    } else confirmation.current?.close()
  }, [targets])
  const cancelDiscard = (): void => {
    setTargets(null)
    discardButton.current?.focus()
  }
  return (
    <section aria-label="Retained rehearsals">
      <h3 ref={heading} tabIndex={-1}>
        Retained rehearsals
      </h3>
      <p>Worktree: {inventory?.repository ?? repo}</p>
      <button
        disabled={busy || query.loading}
        onClick={() => {
          heading.current?.focus()
          query.reload()
        }}
      >
        Refresh history
      </button>
      {query.loading && <p role="status">Refreshing retained history…</p>}
      {query.error && <p role="alert">{query.error}</p>}
      {inventory && (
        <>
          <p>
            Retained logical size: {bytes(inventory.bytes)}. Available disk space:{' '}
            {bytes(inventory.freeBytes)}.
          </p>
          <p>
            Size includes shared Git objects; discarding may free less space. No retained work is
            deleted automatically.
          </p>
          {inventory.entries.length === 0 && <p>No retained rehearsals in this worktree.</p>}
          <ul>
            {inventory.entries.map((entry) => (
              <li key={entry.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Select ${entry.id} for discard`}
                    disabled={busy || entry.active || inventory.protected}
                    checked={checked.includes(entry.id)}
                    onChange={(event) =>
                      setChecked(
                        event.target.checked
                          ? [...checked, entry.id]
                          : checked.filter((id) => id !== entry.id)
                      )
                    }
                  />
                  {entry.id}
                </label>{' '}
                <button
                  disabled={busy}
                  aria-pressed={current === entry.id}
                  onClick={() => {
                    heading.current?.focus()
                    void select(repo, entry)
                  }}
                >
                  Open {entry.id}
                  {current === entry.id ? ' (current)' : ''}
                </button>
                <p>
                  {entry.command.join(' ')} · {entry.checkout.target} ·{' '}
                  {entry.active ? '⚠ Active execution' : entry.execution} ·{' '}
                  {entry.stale ? '⚠ Outdated basis · ' : ''}
                  {bytes(entry.bytes)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        ref={discardButton}
        disabled={busy || !selected.length || inventory?.protected}
        onClick={() => setTargets(selected)}
      >
        Discard selected ({selected.length})
      </button>
      <dialog
        ref={confirmation}
        className="rehearsal-dialog"
        aria-label="Confirm Discard"
        onCancel={(event) => {
          event.preventDefault()
          event.stopPropagation()
          cancelDiscard()
        }}
      >
        <h3>Discard these rehearsals?</h3>
        <p>
          ⚠ This permanently removes the selected sandbox work, including saved conflict
          resolutions.
        </p>
        <ul>
          {targets?.map((entry) => (
            <li key={entry.id}>
              {entry.id}: {entry.command.join(' ')} — {entry.origin_worktree}, checkout{' '}
              {entry.checkout.target}, {bytes(entry.bytes)}
            </li>
          ))}
        </ul>
        <button ref={cancel} onClick={cancelDiscard}>
          Cancel Discard
        </button>{' '}
        <button
          onClick={() => {
            const confirmed = targets
            setTargets(null)
            if (confirmed)
              void discard(repo, confirmed).then(() => {
                setChecked([])
                heading.current?.focus()
              })
          }}
        >
          Discard rehearsals
        </button>
      </dialog>
    </section>
  )
}
