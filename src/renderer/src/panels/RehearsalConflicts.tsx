import { useEffect, useRef, useState } from 'react'
import type { RehearsalConflict, RehearsalReport } from '../../../shared/types'
import { useRepoQuery } from '../lib/repoQuery'
import { useStore } from '../store'
import { assemble, ConflictHunk, type Choice } from './MergeView'

export default function RehearsalConflicts({
  report,
  blocked
}: {
  report: RehearsalReport
  blocked: boolean
}): React.JSX.Element {
  const busy = useStore((s) => s.rehearsalBusy)
  const refresh = useStore((s) => s.refreshRehearsal)
  const [active, setActive] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef<RehearsalConflict | null>(null)
  const { data, error, loading, reload } = useRepoQuery(
    active ? ([report, active] as const) : null,
    (api, [identity, path]) => api.rehearsalConflictRead(identity, path)
  )
  const shown = data?.file.path === active ? data : null
  const disabled = busy || blocked || loading
  useEffect(() => {
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])
  useEffect(() => {
    if (shown && previous.current?.revision !== shown.revision) {
      if (previous.current?.file.path === shown.file.path)
        setNotice(
          '⚠ File reloaded after external changes. Review the current content before saving.'
        )
      heading.current?.focus()
    }
    previous.current = shown
  }, [shown])

  const update = async (resume = false): Promise<void> => {
    const result = await refresh(report, resume)
    if (!resume) reload()
    if (result && result.kind !== 'report') setNotice(`⚠ ${result.message}`)
  }
  return (
    <section aria-label="Sandbox conflict editor">
      <h3 ref={heading} tabIndex={-1}>
        Resolve in sandbox
      </h3>
      <p>
        Rehearsal {report.id}. Original worktree: {report.origin_worktree}. Changes here are saved
        and staged only in the sandbox.
      </p>
      <p>
        Sandbox: <code>{report.sandbox}</code>
      </p>
      <p>
        For deleted, renamed or binary files, resolve and stage externally in this sandbox, then
        refresh. Apply stays unavailable until Continue produces a completed report.
      </p>
      {(error || notice) && <p role="alert">{error ? `⚠ ${error}` : notice}</p>}
      <div>
        {report.conflicts.map((c) => (
          <button key={c.path} disabled={disabled} onClick={() => setActive(c.path)}>
            Resolve {c.path}
          </button>
        ))}
      </div>
      {active && <p>Editing {active}</p>}
      {shown?.file.binary && (
        <p>⚠ This is a binary conflict. Use external whole-file resolution.</p>
      )}
      {shown && !shown.file.binary && (
        <ConflictBuffer
          key={`${active}:${shown.revision}`}
          report={report}
          buffer={shown}
          disabled={disabled}
          onSaved={(message) => {
            setActive(null)
            setNotice(message)
            heading.current?.focus()
          }}
          onError={setNotice}
        />
      )}
      <button disabled={disabled} onClick={() => void update()}>
        Refresh sandbox
      </button>
      <button disabled={disabled || report.conflicts.length > 0} onClick={() => void update(true)}>
        Continue rehearsal
      </button>
    </section>
  )
}

function ConflictBuffer({
  report,
  buffer,
  disabled,
  onSaved,
  onError
}: {
  report: RehearsalReport
  buffer: RehearsalConflict
  disabled: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [choices, setChoices] = useState(new Map<number, Choice>())
  const [edits, setEdits] = useState(new Map<number, string>())
  const [raw, setRaw] = useState<string | null>(null)
  const save = useStore((s) => s.saveRehearsalConflict)
  return (
    <fieldset disabled={disabled}>
      <legend>Conflict content</legend>
      {raw !== null ? (
        <textarea
          className="hunk-edit"
          rows={12}
          aria-label="Resolved file text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      ) : (
        buffer.file.segments.map((seg, i) =>
          seg.kind === 'text' ? (
            <pre key={i}>{seg.text}</pre>
          ) : (
            <ConflictHunk
              key={seg.id}
              seg={seg}
              choice={choices.get(seg.id) ?? 'ours'}
              edit={edits.get(seg.id) ?? seg.ours + seg.theirs}
              onChoice={(c) => setChoices((prev) => new Map(prev).set(seg.id, c))}
              onEdit={(text) => setEdits((prev) => new Map(prev).set(seg.id, text))}
            />
          )
        )
      )}
      <button
        onClick={() => setRaw(assemble(buffer.file.segments, choices, edits))}
        disabled={raw !== null}
      >
        Edit whole file
      </button>
      <button
        onClick={() => {
          void save(
            report,
            buffer.file.path,
            buffer.revision,
            raw ?? assemble(buffer.file.segments, choices, edits)
          ).then((result) => {
            if (result.ok) onSaved(result.message ?? 'Saved in sandbox.')
            else onError(`⚠ ${result.message}`)
          })
        }}
      >
        Save and stage in sandbox
      </button>
    </fieldset>
  )
}
