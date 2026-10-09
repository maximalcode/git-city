import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  RehearsalConflict,
  RehearsalDraftPayload,
  RehearsalDraftRecord,
  RehearsalReport
} from '../../../shared/types'
import { useRepoQuery } from '../lib/repoQuery'
import { bridge } from '../lib/bridge'
import { useStore } from '../store'
import { assemble, ConflictHunk, type Choice } from './MergeView'
import {
  clearRehearsalDraftSession,
  getRehearsalDraftSession,
  rehearsalDraftSessionKey
} from './rehearsalDraftSessions'

export default function RehearsalConflicts({
  report,
  blocked,
  onDirtyStateChange,
  onAbandonAvailable,
  onPrepareNavigationAvailable
}: {
  report: RehearsalReport
  blocked: boolean
  onDirtyStateChange?: (dirty: boolean) => void
  onAbandonAvailable?: (abandon: (() => Promise<boolean>) | null) => void
  onPrepareNavigationAvailable?: (prepare: (() => Promise<boolean>) | null) => void
}): React.JSX.Element {
  const busy = useStore((s) => s.rehearsalBusy)
  const save = useStore((s) => s.saveRehearsalConflict)
  const refresh = useStore((s) => s.refreshRehearsal)
  const [active, setActive] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [editorDirty, setEditorDirty] = useState(false)
  const editorAbandon = useRef<(() => Promise<boolean>) | null>(null)
  const editorPrepare = useRef<(() => Promise<boolean>) | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef<RehearsalConflict | null>(null)
  const { data, error, loading, reload } = useRepoQuery(
    active ? ([report, active] as const) : null,
    (api, [identity, path]) => api.rehearsalConflictRead(identity, path)
  )
  const shown = data?.file.path === active ? data : null
  const disabled = busy || blocked || loading
  const registerEditorAbandon = useCallback((abandon: (() => Promise<boolean>) | null) => {
    editorAbandon.current = abandon
  }, [])
  const selectConflict = async (path: string): Promise<void> => {
    if (path === active || !editorDirty) {
      setActive(path)
      return
    }
    const ready = editorPrepare.current ? await editorPrepare.current() : false
    if (ready) {
      setActive(path)
      return
    }
    if (
      !window.confirm('This conflict draft could not be saved. Abandon it and open another file?')
    )
      return
    const abandoned = editorAbandon.current ? await editorAbandon.current() : false
    if (abandoned) {
      setEditorDirty(false)
      setActive(path)
    }
  }
  useEffect(() => {
    const onFocus = (): void => {
      reload()
      void refresh(report)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload, refresh, report])
  useEffect(() => {
    if (shown && previous.current?.revision !== shown.revision) {
      if (previous.current?.file.path === shown.file.path)
        setNotice(
          '⚠ File reloaded after external changes. Review the current content before saving.'
        )
      if (
        !(document.activeElement as HTMLElement | null)?.closest(
          '[aria-label="Sandbox conflict editor"]'
        )
      )
        heading.current?.focus()
      // The query response and draft restoration can commit in adjacent
      // renders. Reassert focus after that commit so keyboard users land on
      // the editor heading instead of the file button that opened it.
      const focusAgain = window.setTimeout(() => heading.current?.focus(), 0)
      previous.current = shown
      return () => window.clearTimeout(focusAgain)
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
        For deletion or rename conflicts, open the sandbox folder shown above in your editor or
        terminal. Choose the final paths and contents, then stage each resolved path with git add
        (or git rm for a deletion) in that sandbox. Refresh to check the remaining conflicts. Apply
        stays unavailable until Continue produces a completed report.
      </p>
      {(error || notice) && <p role="alert">{error ? `⚠ ${error}` : notice}</p>}
      <div>
        {report.conflicts.map((c) => (
          <button key={c.path} disabled={disabled} onClick={() => void selectConflict(c.path)}>
            Resolve {c.path}
          </button>
        ))}
      </div>
      {active && <p>Editing {active}</p>}
      {shown?.external && (
        <p role="status">
          ⚠ Deletion or rename conflict. One or both versions have no file at this path. Follow the
          external resolution and staging instructions above; no text buffer will be saved here.
        </p>
      )}
      {shown?.file.binary && (
        <fieldset disabled={disabled}>
          <legend>Binary conflict: choose a complete version</legend>
          <p>
            Ours is Git stage 2; Theirs is Git stage 3. During rebase, Ours is the destination and
            Theirs is the commit being replayed. Choosing a version replaces and stages this sandbox
            file.
          </p>
          {(['ours', 'theirs'] as const).map((side) => (
            <button
              key={side}
              onClick={() => {
                void save(report, shown.file.path, shown.revision, { side }).then((result) => {
                  setNotice(result.message ?? 'Saved in sandbox.')
                  if (result.ok) {
                    setActive(null)
                    heading.current?.focus()
                  }
                })
              }}
            >
              Use {side} in sandbox
            </button>
          ))}
        </fieldset>
      )}
      {shown && !shown.external && !shown.file.binary && (
        <ConflictEditor
          key={active}
          report={report}
          buffer={shown}
          disabled={disabled}
          onSaved={(message) => {
            setActive(null)
            setNotice(message)
            heading.current?.focus()
          }}
          onError={setNotice}
          onDirtyStateChange={(dirty) => {
            setEditorDirty(dirty)
            onDirtyStateChange?.(dirty)
          }}
          onAbandonAvailable={(abandon) => {
            registerEditorAbandon(abandon)
            onAbandonAvailable?.(abandon)
          }}
          onPrepareNavigationAvailable={(prepare) => {
            editorPrepare.current = prepare
            onPrepareNavigationAvailable?.(prepare)
          }}
        />
      )}
      <button disabled={disabled} onClick={() => void update()}>
        Refresh sandbox
      </button>
      <button
        disabled={disabled || report.conflicts.length > 0 || editorDirty}
        onClick={() => void update(true)}
      >
        Continue rehearsal
      </button>
    </section>
  )
}

export interface ConflictEditorProps {
  report: RehearsalReport
  buffer: RehearsalConflict
  disabled: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
  onDirtyStateChange?: (dirty: boolean) => void
  onAbandonAvailable?: (abandon: (() => Promise<boolean>) | null) => void
  onPrepareNavigationAvailable?: (prepare: (() => Promise<boolean>) | null) => void
}

/** Stable editor seam for the review workspace; persistence stays behind the public bridge. */
export function ConflictEditor({
  report,
  buffer,
  disabled,
  onSaved,
  onError,
  onDirtyStateChange,
  onAbandonAvailable,
  onPrepareNavigationAvailable
}: ConflictEditorProps): React.JSX.Element {
  const sessionKey = rehearsalDraftSessionKey(report, buffer.file.path)
  const session = getRehearsalDraftSession(sessionKey, buffer.revision)
  const sessionBufferAtMount = useRef(session.hasLocalBuffer)
  const [choices, setChoices] = useState(() => new Map(session.choices))
  const [edits, setEdits] = useState(() => new Map(session.edits))
  const [raw, setRaw] = useState<string | null>(() => session.raw)
  const [draftRevision, setDraftRevision] = useState<number | null>(null)
  const [draftBaseRevision, setDraftBaseRevision] = useState(buffer.revision)
  const [draftStatus, setDraftStatus] = useState<
    'loading' | 'saved' | 'pending' | 'error' | 'unknown' | 'obsolete'
  >('loading')
  const [obsolete, setObsolete] = useState<RehearsalDraftRecord | null>(null)
  const editSequence = useRef(0)
  const savedSequence = useRef(0)
  const savedRevision = useRef<number | null>(null)
  const openedRevision = useRef<string | null>(null)
  const writeQueue = useRef(Promise.resolve())
  const pendingWrites = useRef(0)
  const latestDraftStatus = useRef(draftStatus)
  const dirtyCallback = useRef(onDirtyStateChange)
  const currentState = useRef({ choices, edits, raw, draftBaseRevision })
  currentState.current = { choices, edits, raw, draftBaseRevision }
  latestDraftStatus.current = draftStatus
  dirtyCallback.current = onDirtyStateChange
  session.choices = new Map(choices)
  session.edits = new Map(edits)
  session.raw = raw
  session.baseRevision = draftBaseRevision
  session.hasLocalBuffer =
    raw !== null || choices.size > 0 || edits.size > 0 || draftStatus !== 'loading'
  const save = useStore((s) => s.saveRehearsalConflict)

  useEffect(() => {
    let cancelled = false
    const preserveBuffer =
      ((openedRevision.current === null && sessionBufferAtMount.current) ||
        (openedRevision.current !== null && openedRevision.current !== buffer.revision)) &&
      (currentState.current.raw !== null ||
        currentState.current.choices.size > 0 ||
        currentState.current.edits.size > 0 ||
        latestDraftStatus.current === 'pending' ||
        latestDraftStatus.current === 'error' ||
        latestDraftStatus.current === 'unknown' ||
        latestDraftStatus.current === 'obsolete')
    openedRevision.current = buffer.revision
    setDraftStatus('loading')
    setDraftRevision(null)
    if (!preserveBuffer) setDraftBaseRevision(buffer.revision)
    setObsolete(null)
    if (!preserveBuffer) {
      setChoices(new Map())
      setEdits(new Map())
      setRaw(null)
    }
    const api = bridge()
    if (!api) {
      setDraftStatus('saved')
      dirtyCallback.current?.(false)
      return () => {
        cancelled = true
      }
    }
    void api
      .rehearsalDraftRead(report, buffer.file.path)
      .then((result) => {
        if (cancelled) return
        if (result.record) {
          savedRevision.current = result.record.draft_revision
          setDraftRevision(result.record.draft_revision)
          if (result.record.base_revision !== buffer.revision) {
            setObsolete(result.record)
            setDraftStatus('obsolete')
            dirtyCallback.current?.(true)
            return
          }
          if (!preserveBuffer) restoreRecord(result.record)
          setDraftStatus(result.status === 'unknown' ? 'unknown' : 'saved')
          dirtyCallback.current?.(true)
        } else {
          savedRevision.current = null
          setDraftStatus(result.status === 'unknown' ? 'error' : 'saved')
          dirtyCallback.current?.(preserveBuffer || result.status === 'unknown')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDraftStatus(error instanceof Error ? 'error' : 'error')
          dirtyCallback.current?.(true)
        }
      })
    return () => {
      cancelled = true
    }
    // buffer revision/path is an identity boundary; report is deliberately the full identity.
  }, [buffer.file.path, buffer.revision, report])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (
        pendingWrites.current === 0 &&
        latestDraftStatus.current !== 'error' &&
        latestDraftStatus.current !== 'unknown'
      )
        return
      if (latestDraftStatus.current === 'error' || latestDraftStatus.current === 'unknown') {
        if (window.confirm('The rehearsal draft could not be saved. Quit and abandon it?')) return
        event.preventDefault()
        event.returnValue = ''
        return
      }
      // A close from the native window can happen before the IPC promise has
      // acknowledged its atomic write. Hold the close until that queue settles.
      event.preventDefault()
      event.returnValue = ''
      void writeQueue.current.then(() => {
        if (pendingWrites.current === 0 && latestDraftStatus.current !== 'error') window.close()
      })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      if (
        pendingWrites.current === 0 &&
        latestDraftStatus.current !== 'error' &&
        latestDraftStatus.current !== 'unknown'
      ) {
        window.removeEventListener('beforeunload', onBeforeUnload)
      } else {
        void writeQueue.current.finally(() => {
          if (
            pendingWrites.current === 0 &&
            latestDraftStatus.current !== 'error' &&
            latestDraftStatus.current !== 'unknown'
          )
            window.removeEventListener('beforeunload', onBeforeUnload)
        })
      }
    }
  }, [])

  const restoreRecord = (record: RehearsalDraftRecord): void => {
    const restoredChoices = new Map<number, Choice>()
    for (const [id, choice] of Object.entries(record.choices))
      restoredChoices.set(Number(id), choice)
    const restoredEdits = new Map<number, string>()
    for (const [id, text] of Object.entries(record.edits)) restoredEdits.set(Number(id), text)
    setChoices(restoredChoices)
    setEdits(restoredEdits)
    setRaw(record.whole_file_text)
    setDraftBaseRevision(record.base_revision)
    setDraftRevision(record.draft_revision)
    savedRevision.current = record.draft_revision
  }

  const payload = (
    next: Partial<
      Pick<RehearsalDraftPayload, 'choices' | 'edits' | 'whole_file_text' | 'mode'>
    > = {}
  ): RehearsalDraftPayload => {
    const state = currentState.current
    return {
      base_revision: state.draftBaseRevision,
      base_content: buffer.base_content ?? assemble(buffer.file.segments, new Map(), new Map()),
      mode:
        next.mode ??
        (next.whole_file_text !== undefined || state.raw !== null ? 'whole-file' : 'hunks'),
      whole_file_text: next.whole_file_text !== undefined ? next.whole_file_text : state.raw,
      choices:
        next.choices ??
        Object.fromEntries([...state.choices].map(([id, choice]) => [String(id), choice])),
      edits:
        next.edits ?? Object.fromEntries([...state.edits].map(([id, text]) => [String(id), text])),
      acknowledged_hunks: Object.keys(
        next.choices ?? Object.fromEntries([...state.choices].map(([id]) => [String(id), true]))
      )
    }
  }

  const persist = (
    next: Partial<
      Pick<RehearsalDraftPayload, 'choices' | 'edits' | 'whole_file_text' | 'mode'>
    > = {}
  ): void => {
    const api = bridge()
    if (!api || draftStatus === 'loading') return
    const sequence = ++editSequence.current
    const nextPayload = payload(next)
    onDirtyStateChange?.(true)
    setDraftStatus('pending')
    pendingWrites.current += 1
    writeQueue.current = writeQueue.current
      .then(async () => {
        const result = await api.rehearsalDraftWrite(
          report,
          buffer.file.path,
          nextPayload,
          savedRevision.current
        )
        if (result.status === 'saved' && result.record) {
          savedRevision.current = result.record.draft_revision
          setDraftRevision(result.record.draft_revision)
          if (sequence >= savedSequence.current) savedSequence.current = sequence
          if (sequence === editSequence.current) {
            latestDraftStatus.current = 'saved'
            setDraftStatus('saved')
          }
        } else if (sequence === editSequence.current) {
          latestDraftStatus.current = 'error'
          setDraftStatus('error')
        }
      })
      .catch(() => {
        if (sequence === editSequence.current) {
          latestDraftStatus.current = 'error'
          setDraftStatus('error')
        }
      })
      .finally(() => {
        pendingWrites.current -= 1
      })
  }

  const discardSavedDraft = async (expected = savedRevision.current): Promise<boolean> => {
    const api = bridge()
    if (!api || expected === null) return false
    await writeQueue.current
    const result = await api.rehearsalDraftDiscard(report, buffer.file.path, expected)
    if (result.status === 'absent') {
      savedRevision.current = null
      setDraftRevision(null)
      setObsolete(null)
      setDraftBaseRevision(buffer.revision)
      setDraftStatus('saved')
      setChoices(new Map())
      setEdits(new Map())
      setRaw(null)
      clearRehearsalDraftSession(sessionKey)
      onDirtyStateChange?.(false)
      return true
    }
    return false
  }

  const discardAfterSave = async (expected: number | null): Promise<boolean> => {
    await writeQueue.current
    return discardSavedDraft(expected)
  }
  const abandonDraft = async (): Promise<boolean> => {
    await writeQueue.current
    const expected = savedRevision.current
    if (expected === null) {
      onDirtyStateChange?.(false)
      return true
    }
    const discarded = await discardSavedDraft(expected)
    if (discarded) onDirtyStateChange?.(false)
    return discarded
  }
  const abandonDraftRef = useRef(abandonDraft)
  abandonDraftRef.current = abandonDraft
  const abandonRegistration = useRef(onAbandonAvailable)
  abandonRegistration.current = onAbandonAvailable
  const prepareNavigation = async (): Promise<boolean> => {
    await writeQueue.current
    return latestDraftStatus.current !== 'error' && latestDraftStatus.current !== 'unknown'
  }
  const prepareNavigationRef = useRef(prepareNavigation)
  prepareNavigationRef.current = prepareNavigation
  const prepareRegistration = useRef(onPrepareNavigationAvailable)
  prepareRegistration.current = onPrepareNavigationAvailable
  useEffect(() => {
    const requestAbandon = (): Promise<boolean> => abandonDraftRef.current()
    abandonRegistration.current?.(requestAbandon)
    const requestPrepare = (): Promise<boolean> => prepareNavigationRef.current()
    prepareRegistration.current?.(requestPrepare)
    return () => {
      abandonRegistration.current?.(null)
      prepareRegistration.current?.(null)
    }
  }, [])
  return (
    <fieldset disabled={disabled}>
      <legend>Conflict content</legend>
      {draftStatus === 'loading' && <p>Restoring saved editor draft…</p>}
      {draftStatus === 'pending' && <p>Saving editor draft…</p>}
      {draftStatus === 'saved' && draftRevision !== null && (
        <p>Editor draft saved locally (revision {draftRevision}).</p>
      )}
      {draftStatus === 'error' && (
        <p role="alert">
          ⚠ The editor draft could not be saved. Keep this panel open and try again.
        </p>
      )}
      {draftStatus === 'unknown' && (
        <p role="alert">
          ⚠ The previous draft store was incompatible. Existing draft data was preserved.
        </p>
      )}
      {obsolete && (
        <div role="alert">
          <p>
            ⚠ A saved draft is based on sandbox revision <code>{obsolete.base_revision}</code>,
            while this file is now at <code>{buffer.revision}</code>. It is kept separately until
            you choose what to do.
          </p>
          <button onClick={() => void discardSavedDraft()}>Discard saved draft</button>
          <button
            onClick={() => {
              void discardSavedDraft(obsolete.draft_revision).then((discarded) => {
                if (!discarded) return
                setObsolete(null)
                setDraftBaseRevision(buffer.revision)
                setDraftRevision(null)
                savedRevision.current = null
                setDraftStatus('saved')
                setChoices(new Map())
                setEdits(new Map())
                setRaw(null)
                clearRehearsalDraftSession(sessionKey)
                onDirtyStateChange?.(false)
              })
            }}
          >
            Start from current sandbox
          </button>
          <button onClick={() => restoreRecord(obsolete)}>Restore saved text for review</button>
        </div>
      )}
      {raw !== null ? (
        <textarea
          className="hunk-edit"
          rows={12}
          aria-label="Resolved file text"
          value={raw}
          onChange={(e) => {
            const value = e.target.value
            setRaw(value)
            persist({ mode: 'whole-file', whole_file_text: value })
          }}
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
              onChoice={(c) => {
                const next = new Map(choices).set(seg.id, c)
                setChoices(next)
                persist({
                  choices: Object.fromEntries([...next].map(([id, choice]) => [String(id), choice]))
                })
              }}
              onEdit={(text) => {
                const next = new Map(edits).set(seg.id, text)
                setEdits(next)
                persist({
                  edits: Object.fromEntries([...next].map(([id, value]) => [String(id), value]))
                })
              }}
            />
          )
        )
      )}
      <button
        onClick={() => {
          const value = assemble(buffer.file.segments, choices, edits)
          setRaw(value)
          persist({ mode: 'whole-file', whole_file_text: value })
        }}
        disabled={raw !== null}
      >
        Edit whole file
      </button>
      <button
        disabled={draftBaseRevision !== buffer.revision || draftStatus === 'loading'}
        onClick={() => {
          const savedDraftAtSave = savedRevision.current
          void save(
            report,
            buffer.file.path,
            buffer.revision,
            raw ?? assemble(buffer.file.segments, choices, edits)
          ).then(async (result) => {
            if (result.ok) {
              const discarded = await discardAfterSave(savedDraftAtSave)
              if (discarded || savedDraftAtSave === null) onDirtyStateChange?.(false)
              onSaved(result.message ?? 'Saved in sandbox.')
            } else onError(`⚠ ${result.message}`)
          })
        }}
      >
        Save and stage in sandbox
      </button>
    </fieldset>
  )
}
