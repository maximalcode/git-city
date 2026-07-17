import { useEffect, useState } from 'react'
import type { ConflictFile, ConflictSegment } from '../../../shared/types'
import { hasApi, useStore } from '../store'

export type Choice = 'ours' | 'theirs' | 'both' | 'edit'

/**
 * Assemble the resolved file text from the current per-hunk choices.
 * Exported for tests. The 'edit' fallback MUST match what the textarea shows
 * for an untouched edit (ours+theirs) so displayed text === written text.
 */
export function assemble(
  segments: ConflictSegment[],
  choices: Map<number, Choice>,
  edits: Map<number, string>
): string {
  return segments
    .map((seg) => {
      if (seg.kind === 'text') return seg.text
      const choice = choices.get(seg.id) ?? 'ours'
      if (choice === 'edit') return edits.get(seg.id) ?? seg.ours + seg.theirs
      if (choice === 'theirs') return seg.theirs
      if (choice === 'both') return seg.ours + seg.theirs
      return seg.ours
    })
    .join('')
}

export default function MergeView(): React.JSX.Element | null {
  const mergeView = useStore((s) => s.mergeView)
  const status = useStore((s) => s.workingStatus)
  const repoPath = useStore((s) => s.repoPath)
  const busy = useStore((s) => s.opInProgress !== null)
  const setMergeActive = useStore((s) => s.setMergeActive)
  const closeMergeView = useStore((s) => s.closeMergeView)
  const resolveConflict = useStore((s) => s.resolveConflict)
  const resolveWhole = useStore((s) => s.resolveWhole)
  const abortOp = useStore((s) => s.abortOp)
  const continueOp = useStore((s) => s.continueOp)
  const askConfirm = useStore((s) => s.askConfirm)

  const conflicted = (status?.files ?? []).filter((f) => f.conflicted).map((f) => f.path)
  const active = mergeView?.active ?? conflicted[0] ?? null

  const [file, setFile] = useState<ConflictFile | null>(null)
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map())
  const [edits, setEdits] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    if (!mergeView || !active || !repoPath || !hasApi()) {
      setFile(null)
      return
    }
    let cancelled = false
    void window.gitCity.conflictRead(repoPath, active).then((f) => {
      if (cancelled) return
      setFile(f)
      setChoices(new Map())
      setEdits(new Map())
    })
    return () => {
      cancelled = true
    }
  }, [mergeView, active, repoPath])

  if (!mergeView) return null

  const setChoice = (id: number, c: Choice): void => {
    setChoices((prev) => new Map(prev).set(id, c))
    // Seed the edit buffer with what the textarea will display, so an
    // untouched "Edit" resolves to exactly the text the user saw.
    if (c === 'edit' && file) {
      const seg = file.segments.find(
        (s): s is Extract<ConflictSegment, { kind: 'conflict' }> =>
          s.kind === 'conflict' && s.id === id
      )
      if (seg) {
        setEdits((prev) => (prev.has(id) ? prev : new Map(prev).set(id, seg.ours + seg.theirs)))
      }
    }
  }
  const setEdit = (id: number, text: string): void => setEdits((prev) => new Map(prev).set(id, text))

  const markResolved = (): void => {
    if (!file || !active) return
    if (file.binary) return
    void resolveConflict(active, assemble(file.segments, choices, edits))
  }

  const allResolved = conflicted.length === 0
  const source = mergeView.source

  const doAbort = (): void =>
    askConfirm({
      title: `Abort ${source}?`,
      body: 'This throws away the in-progress operation and restores your branch to its previous state.',
      confirmLabel: 'Abort',
      danger: true,
      onConfirm: () => void abortOp()
    })

  return (
    <div className="merge-view">
      <div className="merge-head">
        <span className="merge-title">Resolve conflicts · {source}</span>
        <div className="spacer" />
        <button onClick={doAbort} className="danger" disabled={busy}>
          Abort {source}
        </button>
        <button className="primary" disabled={busy || !allResolved} onClick={() => void continueOp()}>
          Continue
        </button>
        <button className="close" aria-label="Close" onClick={closeMergeView}>
          ✕
        </button>
      </div>

      <div className="merge-body">
        <div className="merge-rail">
          {conflicted.length === 0 && <div className="empty">All conflicts resolved 🎉</div>}
          {conflicted.map((p) => (
            <div
              key={p}
              className={`rail-item ${p === active ? 'active' : ''}`}
              onClick={() => setMergeActive(p)}
            >
              {p}
            </div>
          ))}
          {/* files already resolved this session drop out of `conflicted` */}
        </div>

        <div className="merge-main">
          {!active && <div className="empty">Select a file to resolve.</div>}
          {active && file?.binary && (
            <div className="binary-resolve">
              <p>
                <code>{active}</code> is a binary file and can't be merged line by line.
              </p>
              <div className="hunk-actions">
                <button disabled={busy} onClick={() => void resolveWhole(active, 'ours')}>
                  Keep ours
                </button>
                <button disabled={busy} onClick={() => void resolveWhole(active, 'theirs')}>
                  Keep theirs
                </button>
              </div>
            </div>
          )}
          {active && file && !file.binary && (
            <>
              <div className="merge-segments">
                {file.segments.map((seg, i) =>
                  seg.kind === 'text' ? (
                    <pre key={i} className="seg-text">
                      {seg.text}
                    </pre>
                  ) : (
                    <ConflictHunk
                      key={seg.id}
                      seg={seg}
                      choice={choices.get(seg.id) ?? 'ours'}
                      edit={edits.get(seg.id) ?? seg.ours + seg.theirs}
                      onChoice={(c) => setChoice(seg.id, c)}
                      onEdit={(t) => setEdit(seg.id, t)}
                    />
                  )
                )}
              </div>
              <div className="merge-file-foot">
                <button
                  disabled={busy}
                  onClick={() =>
                    repoPath && hasApi() && window.gitCity.openInEditor(repoPath, active)
                  }
                >
                  Open in external editor
                </button>
                <button className="primary" disabled={busy} onClick={markResolved}>
                  Mark resolved
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ConflictHunk({
  seg,
  choice,
  edit,
  onChoice,
  onEdit
}: {
  seg: Extract<ConflictSegment, { kind: 'conflict' }>
  choice: Choice
  edit: string
  onChoice: (c: Choice) => void
  onEdit: (text: string) => void
}): React.JSX.Element {
  return (
    <div className="hunk">
      <div className="hunk-actions">
        <button className={choice === 'ours' ? 'active' : ''} onClick={() => onChoice('ours')}>
          Ours{seg.oursLabel ? ` (${seg.oursLabel})` : ''}
        </button>
        <button className={choice === 'theirs' ? 'active' : ''} onClick={() => onChoice('theirs')}>
          Theirs{seg.theirsLabel ? ` (${seg.theirsLabel})` : ''}
        </button>
        <button className={choice === 'both' ? 'active' : ''} onClick={() => onChoice('both')}>
          Both
        </button>
        <button className={choice === 'edit' ? 'active' : ''} onClick={() => onChoice('edit')}>
          Edit
        </button>
      </div>
      {choice === 'edit' ? (
        <textarea className="hunk-edit" value={edit} onChange={(e) => onEdit(e.target.value)} />
      ) : (
        <div className="hunk-preview">
          {(choice === 'ours' || choice === 'both') && <pre className="seg-ours">{seg.ours}</pre>}
          {(choice === 'theirs' || choice === 'both') && (
            <pre className="seg-theirs">{seg.theirs}</pre>
          )}
        </div>
      )}
    </div>
  )
}
