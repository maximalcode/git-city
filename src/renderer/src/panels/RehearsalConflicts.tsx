import { useEffect, useRef, useState } from 'react'
import type { RehearsalConflict, RehearsalReport } from '../../../shared/types'
import { bridge, cleanError } from '../lib/bridge'
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
  const [buffer, setBuffer] = useState<RehearsalConflict | null>(null)
  const [choices, setChoices] = useState(new Map<number, Choice>())
  const [edits, setEdits] = useState(new Map<number, string>())
  const [raw, setRaw] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const generation = useRef(0)
  const loadedRevision = useRef<string | null>(null)
  const disabled = busy || blocked || saving

  useEffect(() => {
    let cancelled = false
    const load = async (focusRefresh = false): Promise<void> => {
      if (!active) return
      const epoch = ++generation.current
      try {
        const value = await bridge()!.rehearsalConflictRead(report, active)
        if (cancelled || epoch !== generation.current) return
        if (focusRefresh && loadedRevision.current === value.revision) return
        loadedRevision.current = value.revision
        setBuffer(value)
        setChoices(new Map())
        setEdits(new Map())
        setRaw(null)
        if (focusRefresh)
          setNotice(
            '⚠ File reloaded after external changes. Review the current content before saving.'
          )
        if (!focusRefresh) heading.current?.focus()
      } catch (error) {
        if (!cancelled && epoch === generation.current) {
          setBuffer(null)
          setNotice(cleanError(error))
        }
      }
    }
    loadedRevision.current = null
    setBuffer(null)
    setNotice('')
    void load()
    const onFocus = (): void => {
      void load(true)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [active, report])

  const update = async (resume = false): Promise<void> => {
    const result = await refresh(report, resume)
    if (result && result.kind !== 'report') setNotice(`⚠ ${result.message}`)
  }
  const save = async (): Promise<void> => {
    if (!active || !buffer || disabled) return
    setSaving(true)
    ++generation.current
    try {
      await bridge()!.rehearsalConflictSave(
        report,
        active,
        buffer.revision,
        raw ?? assemble(buffer.file.segments, choices, edits)
      )
      setActive(null)
      setBuffer(null)
      setNotice('Saved and staged in the sandbox. Continue to finish the rehearsal.')
      await update()
    } catch (error) {
      setNotice(`⚠ ${cleanError(error)}`)
    } finally {
      setSaving(false)
      heading.current?.focus()
    }
  }
  const shown = buffer?.file.path === active ? buffer : null
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
      {notice && <p role="alert">{notice}</p>}
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
            shown.file.segments.map((seg, i) =>
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
            onClick={() => setRaw(assemble(shown.file.segments, choices, edits))}
            disabled={raw !== null}
          >
            Edit whole file
          </button>
          <button onClick={() => void save()}>Save and stage in sandbox</button>
        </fieldset>
      )}
      {active && (
        <button
          disabled={disabled}
          onClick={() => {
            void bridge()!
              .rehearsalConflictOpen(report, active)
              .catch((e) => setNotice(`⚠ ${cleanError(e)}`))
          }}
        >
          Open sandbox file in external editor
        </button>
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
