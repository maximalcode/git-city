import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseConflictSegments } from '../../../shared/conflictSegments'
import type {
  RehearsalConflict,
  RehearsalDraftPayload,
  RehearsalDraftRecord,
  RehearsalReport
} from '../../../shared/types'
import { runRepoRead, useRepoQuery } from '../lib/repoQuery'
import { bridge } from '../lib/bridge'
import { useStore } from '../store'
import { assemble, ConflictHunk, type Choice } from './MergeView'
import {
  rehearsalResolutionReadiness,
  WHOLE_FILE_DECISION
} from '../lib/rehearsalConflictDecisions'
import {
  clearRehearsalDraftSession,
  getRehearsalDraftSession,
  rehearsalDraftSessionKey
} from './rehearsalDraftSessions'

function draftText(record: RehearsalDraftPayload): string {
  return (
    record.whole_file_text ??
    assemble(
      parseConflictSegments(record.base_content),
      new Map(Object.entries(record.choices).map(([id, choice]) => [Number(id), choice])),
      new Map(Object.entries(record.edits).map(([id, text]) => [Number(id), text]))
    )
  )
}

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
  const owner = rehearsalDraftSessionKey(report, '')
  const [selection, setSelection] = useState<{ owner: string; path: string | null }>({
    owner,
    path: null
  })
  const active =
    (selection.owner === owner ? selection.path : null) ?? report.conflicts[0]?.path ?? null
  const setActive = (path: string | null): void => setSelection({ owner, path })
  const [notice, setNotice] = useState('')
  const [editorDirty, setEditorDirty] = useState(false)
  const editorAbandon = useRef<(() => Promise<boolean>) | null>(null)
  const editorPrepare = useRef<(() => Promise<boolean>) | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef<RehearsalConflict | null>(null)
  const drafts = useRepoQuery([report] as const, (api, [identity]) =>
    api.rehearsalDraftList(identity)
  )
  const outstanding =
    drafts.data?.records.filter(
      (record) => !report.conflicts.some((conflict) => conflict.path === record.key.path)
    ) ?? []
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
    if (path === active) {
      heading.current?.focus()
      return
    }
    if (!editorDirty) {
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
      previous.current = shown
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
      {drafts.error && <p role="alert">Saved drafts could not be inspected: {drafts.error}</p>}
      {drafts.data?.status === 'unknown' && <p role="alert">{drafts.data.message}</p>}
      {outstanding.map((record) => (
        <section key={record.key.path} aria-label={`Retained draft for ${record.key.path}`}>
          <p>
            A saved draft for {record.key.path} remains, although the sandbox no longer lists it as
            unresolved. Review it before Continue.
          </p>
          <details>
            <summary>Inspect retained draft for {record.key.path}</summary>
            <pre>{draftText(record)}</pre>
          </details>
          <button
            onClick={() => {
              void bridge()
                ?.rehearsalDraftDiscard(report, record.key.path, record.draft_revision)
                .then((result) => {
                  if (result.status !== 'absent') {
                    setNotice(result.message ?? 'The draft changed and was kept.')
                    return
                  }
                  clearRehearsalDraftSession(rehearsalDraftSessionKey(report, record.key.path))
                  if (active === record.key.path) {
                    setEditorDirty(false)
                    onDirtyStateChange?.(false)
                  }
                  drafts.reload()
                })
                .catch(() => setNotice('The retained draft could not be discarded. It was kept.'))
            }}
          >
            Discard retained draft for {record.key.path}
          </button>
        </section>
      ))}
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
          key={rehearsalDraftSessionKey(report, shown.file.path)}
          report={report}
          buffer={shown}
          disabled={disabled}
          onSaved={(message) => {
            setActive(null)
            setNotice(message)
            drafts.reload()
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
        disabled={
          disabled ||
          report.conflicts.length > 0 ||
          editorDirty ||
          outstanding.length > 0 ||
          drafts.loading ||
          !!drafts.error
        }
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
  const session = getRehearsalDraftSession(sessionKey, buffer.revision, buffer.base_content ?? '')
  const sessionBufferAtMount = useRef(session.hasLocalBuffer)
  const [choices, setChoices] = useState(() => new Map(session.choices))
  const [edits, setEdits] = useState(() => new Map(session.edits))
  const [raw, setRaw] = useState<string | null>(() => session.raw)
  const [acknowledgements, setAcknowledgements] = useState(() => [...session.acknowledgements])
  const [draftRevision, setDraftRevision] = useState<number | null>(null)
  const [draftBaseRevision, setDraftBaseRevision] = useState(session.baseRevision)
  const [draftBaseContent, setDraftBaseContent] = useState(session.baseContent)
  const [draftStatus, setDraftStatus] = useState<
    'loading' | 'saved' | 'pending' | 'error' | 'unknown' | 'obsolete'
  >('loading')
  const [obsolete, setObsolete] = useState<RehearsalDraftRecord | null>(null)
  const [saving, setSaving] = useState(false)
  const hunkElements = useRef(new Map<number, HTMLElement>())
  const editSequence = useRef(0)
  const savedSequence = useRef(0)
  const savedRevision = useRef<number | null>(null)
  const openedRevision = useRef<string | null>(null)
  const writeQueue = useRef(Promise.resolve())
  const pendingWrites = useRef(0)
  const latestDraftStatus = useRef(draftStatus)
  const dirtyCallback = useRef(onDirtyStateChange)
  const currentState = useRef({
    choices,
    edits,
    raw,
    draftBaseRevision,
    draftBaseContent,
    acknowledgements
  })
  currentState.current = {
    choices,
    edits,
    raw,
    draftBaseRevision,
    draftBaseContent,
    acknowledgements
  }
  latestDraftStatus.current = draftStatus
  dirtyCallback.current = onDirtyStateChange
  session.choices = new Map(choices)
  session.edits = new Map(edits)
  session.raw = raw
  session.acknowledgements = [...acknowledgements]
  session.baseRevision = draftBaseRevision
  session.baseContent = draftBaseContent
  session.hasLocalBuffer =
    raw !== null || choices.size > 0 || edits.size > 0 || draftStatus !== 'loading'
  const save = useStore((s) => s.saveRehearsalConflict)
  const identity = useMemo(
    () => ({
      id: report.id,
      repository: report.repository,
      repository_id: report.repository_id,
      origin_worktree: report.origin_worktree
    }),
    [report.id, report.repository, report.repository_id, report.origin_worktree]
  )

  const restoreRecord = useCallback(
    (record: RehearsalDraftRecord): void => {
      const restoredChoices = new Map<number, Choice>()
      for (const [id, choice] of Object.entries(record.choices))
        restoredChoices.set(Number(id), choice)
      const restoredEdits = new Map<number, string>()
      for (const [id, text] of Object.entries(record.edits)) restoredEdits.set(Number(id), text)
      setChoices(restoredChoices)
      setEdits(restoredEdits)
      setRaw(record.whole_file_text)
      setAcknowledgements(record.base_revision === buffer.revision ? record.acknowledged_hunks : [])
      setDraftBaseRevision(record.base_revision)
      setDraftBaseContent(record.base_content)
      setDraftRevision(record.draft_revision)
      savedRevision.current = record.draft_revision
    },
    [buffer.revision]
  )
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
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
    if (!preserveBuffer) {
      setDraftBaseRevision(buffer.revision)
      setDraftBaseContent(buffer.base_content ?? '')
    }
    setObsolete(null)
    if (!preserveBuffer) {
      setChoices(new Map())
      setEdits(new Map())
      setRaw(null)
      setAcknowledgements([])
    }
    const api = bridge()
    if (!api) {
      setDraftStatus('saved')
      dirtyCallback.current?.(false)
      return
    }
    return runRepoRead(
      () => api.rehearsalDraftRead(identity, buffer.file.path),
      (patch) => {
        if (patch.error) {
          setDraftStatus('error')
          dirtyCallback.current?.(true)
        }
        const result = patch.data
        if (!result) return
        if (result.record) {
          savedRevision.current = result.record.draft_revision
          setDraftRevision(result.record.draft_revision)
          if (result.record.base_revision !== buffer.revision) {
            setAcknowledgements([])
            setObsolete(result.record)
            setDraftStatus('obsolete')
            dirtyCallback.current?.(true)
            return
          }
          if (!preserveBuffer) restoreRecord(result.record)
          setDraftStatus(
            sessionRef.current.persistenceFailed
              ? 'error'
              : result.status === 'unknown'
                ? 'unknown'
                : 'saved'
          )
          dirtyCallback.current?.(true)
        } else {
          savedRevision.current = null
          setDraftStatus(
            sessionRef.current.persistenceFailed || ['unknown', 'error'].includes(result.status)
              ? 'error'
              : 'saved'
          )
          dirtyCallback.current?.(preserveBuffer || ['unknown', 'error'].includes(result.status))
        }
      }
    )
    // The shared read boundary drops responses from an obsolete sandbox revision.
  }, [buffer.file.path, buffer.revision, buffer.base_content, identity, restoreRecord])

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
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const payload = (next: Partial<RehearsalDraftPayload> = {}): RehearsalDraftPayload => {
    const state = currentState.current
    return {
      base_revision: next.base_revision ?? state.draftBaseRevision,
      base_content: next.base_content ?? state.draftBaseContent,
      mode:
        next.mode ??
        (next.whole_file_text !== undefined || state.raw !== null ? 'whole-file' : 'hunks'),
      whole_file_text: next.whole_file_text !== undefined ? next.whole_file_text : state.raw,
      choices:
        next.choices ??
        Object.fromEntries([...state.choices].map(([id, choice]) => [String(id), choice])),
      edits:
        next.edits ?? Object.fromEntries([...state.edits].map(([id, text]) => [String(id), text])),
      acknowledged_hunks: next.acknowledged_hunks ?? state.acknowledgements
    }
  }

  const persist = (next: Partial<RehearsalDraftPayload> = {}): void => {
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
            session.persistenceFailed = false
            latestDraftStatus.current = 'saved'
            setDraftStatus('saved')
          }
        } else if (sequence === editSequence.current) {
          session.persistenceFailed = true
          latestDraftStatus.current = 'error'
          setDraftStatus('error')
        }
      })
      .catch(() => {
        if (sequence === editSequence.current) {
          session.persistenceFailed = true
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
    if (!api) return false
    await writeQueue.current
    const result = await api.rehearsalDraftDiscard(report, buffer.file.path, expected)
    if (result.status === 'absent') {
      session.persistenceFailed = false
      savedRevision.current = null
      setDraftRevision(null)
      setObsolete(null)
      setDraftBaseRevision(buffer.revision)
      setDraftBaseContent(buffer.base_content ?? '')
      setDraftStatus('saved')
      setChoices(new Map())
      setEdits(new Map())
      setRaw(null)
      setAcknowledgements([])
      clearRehearsalDraftSession(sessionKey)
      onDirtyStateChange?.(false)
      return true
    }
    return false
  }

  const abandonDraft = async (): Promise<boolean> => {
    await writeQueue.current
    const expected = savedRevision.current
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
    return !['error', 'unknown', 'loading'].includes(latestDraftStatus.current)
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
  const readiness = rehearsalResolutionReadiness(buffer.file.segments, payload(), buffer.revision)
  const retainedDraft =
    draftBaseRevision !== buffer.revision && (raw !== null || choices.size > 0 || edits.size > 0)
      ? { ...payload(), draft_revision: savedRevision.current }
      : obsolete
  const rebase = report.command[0] === 'rebase'
  const oursMeaning = rebase ? 'destination' : `current checkout ${report.checkout.target}`
  const theirsMeaning = rebase ? 'replayed commit' : 'incoming version'
  const acknowledge = (ids: number[], choice: Choice, confirmEdit = false): void => {
    const next = new Map(choices)
    for (const id of ids) next.set(id, choice)
    const acknowledged =
      choice === 'edit' && !confirmEdit
        ? acknowledgements.filter((id) => !ids.includes(Number(id)))
        : [...new Set([...acknowledgements, ...ids.map(String)])]
    setChoices(next)
    setAcknowledgements(acknowledged)
    persist({ choices: Object.fromEntries(next), acknowledged_hunks: acknowledged })
  }
  const saveResolution = async (): Promise<void> => {
    if (disabled || saving) return
    setSaving(true)
    try {
      await writeQueue.current
      const decision = rehearsalResolutionReadiness(
        buffer.file.segments,
        payload(),
        buffer.revision
      )
      if (!decision.eligible) {
        onError(decision.reason ?? 'Review every conflict section before saving.')
        return
      }
      const savedDraftAtSave = savedRevision.current
      const state = currentState.current
      const result = await save(
        report,
        buffer.file.path,
        buffer.revision,
        state.raw ?? assemble(buffer.file.segments, state.choices, state.edits)
      )
      if (!result.ok) {
        onError(`⚠ ${result.message}`)
        return
      }
      if (savedDraftAtSave !== null && !(await discardSavedDraft(savedDraftAtSave))) {
        onError(
          'Saved and staged in the sandbox, but a newer local draft remains. Review it before Continue.'
        )
        return
      }
      clearRehearsalDraftSession(sessionKey)
      onDirtyStateChange?.(false)
      onSaved(result.message ?? 'Saved in sandbox.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <fieldset disabled={disabled || saving || draftStatus === 'loading'}>
      <legend>Conflict content</legend>
      {draftStatus === 'loading' && <p>Restoring saved editor draft…</p>}
      {draftStatus === 'pending' && <p>Saving editor draft…</p>}
      {draftStatus === 'saved' && draftRevision !== null && (
        <p>Editor draft saved locally (revision {draftRevision}).</p>
      )}
      {draftStatus === 'error' && (
        <div role="alert">
          <p>⚠ The editor draft could not be saved. Keep this panel open and try again.</p>
          <button onClick={() => persist()}>Retry saving editor draft</button>
        </div>
      )}
      {draftStatus === 'unknown' && (
        <p role="alert">
          ⚠ The previous draft store was incompatible. Existing draft data was preserved.
        </p>
      )}
      {retainedDraft && (
        <div role="alert">
          <p>
            ⚠ A retained draft is based on sandbox revision{' '}
            <code>{retainedDraft.base_revision}</code>, while this file is now at{' '}
            <code>{buffer.revision}</code>. It is kept separately until you choose what to do.
          </p>
          <button onClick={() => void abandonDraft()}>Discard saved draft</button>
          <button
            onClick={() => {
              void abandonDraft().then((discarded) => {
                if (!discarded) return
                setObsolete(null)
                setDraftBaseRevision(buffer.revision)
                setDraftBaseContent(buffer.base_content ?? '')
              })
            }}
          >
            Start from current sandbox
          </button>
          <details>
            <summary>Inspect retained draft and its original base</summary>
            <h4>Retained draft</h4>
            <pre>{draftText(retainedDraft)}</pre>
            <h4>Original draft base</h4>
            <pre>{retainedDraft.base_content}</pre>
          </details>
          <button
            onClick={() => {
              const text = draftText(retainedDraft)
              setRaw(text)
              setChoices(new Map())
              setEdits(new Map())
              setAcknowledgements([])
              setDraftBaseRevision(buffer.revision)
              setDraftBaseContent(buffer.base_content ?? '')
              setObsolete(null)
              persist({
                base_revision: buffer.revision,
                base_content: buffer.base_content ?? '',
                mode: 'whole-file',
                whole_file_text: text,
                choices: {},
                edits: {},
                acknowledged_hunks: []
              })
            }}
          >
            Use retained text as a new draft on the current base
          </button>
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
            setAcknowledgements([])
            persist({ mode: 'whole-file', whole_file_text: value, acknowledged_hunks: [] })
          }}
        />
      ) : (
        buffer.file.segments.map((seg, i) =>
          seg.kind === 'text' ? (
            <pre key={i}>{seg.text}</pre>
          ) : (
            <section
              key={seg.id}
              tabIndex={-1}
              aria-label={`Conflict section ${seg.id + 1}`}
              ref={(element) => {
                if (element) hunkElements.current.set(seg.id, element)
                else hunkElements.current.delete(seg.id)
              }}
            >
              <h4>
                Section {seg.id + 1}:{' '}
                {acknowledgements.includes(String(seg.id)) ? 'Decided' : 'Unreviewed'}
              </h4>
              <ConflictHunk
                seg={{
                  ...seg,
                  oursLabel: `${oursMeaning} — ${seg.oursLabel}`,
                  theirsLabel: `${theirsMeaning} — ${seg.theirsLabel}`
                }}
                choice={choices.get(seg.id) ?? 'ours'}
                decided={acknowledgements.includes(String(seg.id))}
                edit={edits.get(seg.id) ?? seg.ours + seg.theirs}
                onChoice={(choice) => acknowledge([seg.id], choice)}
                onEdit={(text) => {
                  const next = new Map(edits).set(seg.id, text)
                  const remaining = acknowledgements.filter((id) => id !== String(seg.id))
                  setEdits(next)
                  setAcknowledgements(remaining)
                  persist({ edits: Object.fromEntries(next), acknowledged_hunks: remaining })
                }}
              />
              {choices.get(seg.id) === 'edit' && (
                <button
                  onClick={() => acknowledge([seg.id], 'edit', true)}
                  disabled={acknowledgements.includes(String(seg.id))}
                >
                  Confirm section {seg.id + 1} edit
                </button>
              )}
            </section>
          )
        )
      )}
      <button
        onClick={() => {
          const value = assemble(buffer.file.segments, choices, edits)
          setRaw(value)
          setAcknowledgements([])
          persist({ mode: 'whole-file', whole_file_text: value, acknowledged_hunks: [] })
        }}
        disabled={raw !== null}
      >
        Edit whole file
      </button>
      {raw !== null ? (
        <button
          disabled={acknowledgements.includes(WHOLE_FILE_DECISION)}
          onClick={() => {
            setAcknowledgements([WHOLE_FILE_DECISION])
            persist({ acknowledged_hunks: [WHOLE_FILE_DECISION] })
          }}
        >
          Confirm complete file resolution
        </button>
      ) : (
        <div>
          <p role="status">{readiness.unreviewed.length} unreviewed conflict sections.</p>
          <button
            disabled={!readiness.unreviewed.length}
            onClick={() => hunkElements.current.get(readiness.unreviewed[0])?.focus()}
          >
            Next unreviewed section
          </button>
          {(['ours', 'theirs', 'both'] as const).map((choice) => (
            <button
              key={choice}
              disabled={!readiness.unreviewed.length}
              onClick={() => acknowledge(readiness.unreviewed, choice)}
            >
              Use{' '}
              {choice === 'ours'
                ? `Ours (${oursMeaning})`
                : choice === 'theirs'
                  ? `Theirs (${theirsMeaning})`
                  : 'both versions'}{' '}
              for all remaining sections
            </button>
          ))}
        </div>
      )}
      <details>
        <summary>Inspect complete resolution</summary>
        <pre>{raw ?? assemble(buffer.file.segments, choices, edits)}</pre>
      </details>
      <p>These decisions choose conflict content; they do not mean tests passed.</p>
      {readiness.reason && <p role="status">{readiness.reason}</p>}
      <button
        disabled={!readiness.eligible || draftStatus === 'loading'}
        onClick={() => void saveResolution()}
      >
        Save and stage in sandbox
      </button>
    </fieldset>
  )
}
