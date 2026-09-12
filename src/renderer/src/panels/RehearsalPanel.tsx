import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../lib/bridge'
import type { RehearsalReport } from '../../../shared/types'

function Report({ report }: { report: RehearsalReport }): React.JSX.Element {
  const noOp =
    report.outcome === 'clean' &&
    report.refs.length === 0 &&
    !report.drift_unexpected &&
    report.conflicts.length === 0
  const status = report.conflicted
    ? 'Conflicts need attention'
    : noOp
      ? 'No-op — no branch changes'
      : {
          clean: 'Merge preview completed',
          stopped: 'Merge stopped',
          failed: 'Git could not complete the merge',
          incomplete: 'Merge execution is incomplete'
        }[report.outcome]
  return (
    <>
      <h3 tabIndex={-1}>{status}</h3>
      <p>
        Kept rehearsal: <code>{report.id}</code>
      </p>
      <p>
        Original worktree: {report.origin_worktree}
        <br />
        Checkout: {report.checkout.target}
        <br />
        Action: {report.command.join(' ')}
      </p>
      <p>⚠ Repository hooks were not run. A clean Git result does not guarantee correct content.</p>
      {report.drift_unexpected && (
        <p role="alert">⚠ Unexpected content changes — review the affected files carefully.</p>
      )}
      <h4>Branches and commits</h4>
      {report.refs.length === 0 ? (
        <p>No branch or commit movements reported.</p>
      ) : (
        <ul>
          {report.refs.map((ref) => (
            <li key={ref.name}>
              {ref.name}: <code>{ref.before ?? '(new)'}</code> →{' '}
              <code>{ref.after ?? '(deleted)'}</code>
            </li>
          ))}
        </ul>
      )}
      <h4>File consequences</h4>
      {report.drift.length === 0 && <p>No completed file comparison reported.</p>}
      {report.drift.map((drift) => (
        <section key={drift.reference}>
          <p>
            {drift.reference}: {drift.commits_before} commits before, {drift.commits_after} after
          </p>
          <ul>
            {drift.files.map((file) => (
              <li key={file.path}>
                {file.status} {file.path}
              </li>
            ))}
          </ul>
          {drift.replay.changed.map((subject, i) => (
            <p key={`changed-${i}`}>⚠ Changed patch: {subject}</p>
          ))}
          {drift.replay.dropped.map((subject, i) => (
            <p key={`dropped-${i}`}>Dropped commit: {subject}</p>
          ))}
          {drift.replay.added.map((subject, i) => (
            <p key={`added-${i}`}>Added commit: {subject}</p>
          ))}
        </section>
      ))}
      <h4>Conflicts</h4>
      {report.conflicts.length === 0 ? (
        <p>No unmerged paths reported.</p>
      ) : (
        <ul>
          {report.conflicts.map((conflict) => (
            <li key={conflict.path}>
              ⚠ {conflict.path} ({conflict.hunks} conflict hunks)
            </li>
          ))}
        </ul>
      )}
      {report.carried && (
        <>
          <h4>Tracked local work</h4>
          <p>
            {report.carried.status}: {report.carried.paths.join(', ')}
          </p>
          <p>{report.carried.reason}</p>
        </>
      )}
      <p>
        Untracked files are not represented as carried work. The original checkout has not been
        changed by this preview.
      </p>
    </>
  )
}

export default function RehearsalPanel(): React.JSX.Element | null {
  const [available, setAvailable] = useState(false)
  const [target, setTarget] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const repo = useStore((s) => s.repoPath)
  const open = useStore((s) => s.rehearsalOpen)
  const busy = useStore((s) => s.rehearsalBusy)
  const result = useStore((s) => (repo ? s.rehearsalResults[repo] : undefined))
  const openPanel = useStore((s) => s.openRehearsal)
  const close = useStore((s) => s.closeRehearsal)
  const rehearse = useStore((s) => s.rehearseMerge)

  useEffect(() => {
    // There is no public entry point, even when a packaged app inherits the env var.
    if (!import.meta.env.DEV) return
    void bridge()
      ?.rehearsalAvailability()
      .then((value) => setAvailable(value.configured))
      .catch(() => setAvailable(false))
  }, [])
  useEffect(() => {
    if (open && available && repo) {
      dialog.current?.showModal()
      input.current?.focus()
    } else {
      dialog.current?.close()
      if (available) trigger.current?.focus()
    }
  }, [open, available, repo])
  useEffect(() => {
    if (result && open && !busy) status.current?.focus()
  }, [result, open, busy])

  if (!available || !repo) return null
  return (
    <>
      <button ref={trigger} className="rehearsal-trigger" onClick={openPanel}>
        Rehearse (internal)
      </button>
      <dialog
        ref={dialog}
        className="rehearsal-dialog"
        aria-labelledby="rehearsal-title"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
      >
        <h2 id="rehearsal-title">Rehearse merge</h2>
        <p>
          Internal development preview. Closing keeps the rehearsal; it does not stop a running
          merge.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void rehearse(target)
          }}
        >
          <label htmlFor="rehearsal-target">
            Branch or commit to merge into the current checkout
          </label>
          <input
            id="rehearsal-target"
            ref={input}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            disabled={busy}
            required
          />
          <button type="submit" disabled={busy || !target.trim()}>
            {busy ? 'Rehearsing…' : 'Rehearse'}
          </button>
        </form>
        <div ref={status} tabIndex={-1} aria-live="polite" aria-busy={busy}>
          {result?.kind === 'report' ? (
            <Report report={result.report} />
          ) : (
            result && (
              <p role="alert">
                ⚠{' '}
                {result.kind === 'refused'
                  ? 'Rehearsal refused'
                  : result.kind === 'unavailable'
                    ? 'Rehearse unavailable'
                    : 'Rehearsal error'}
                : {result.message}
              </p>
            )
          )}
        </div>
        <p id="apply-unavailable">
          Apply is not available in this internal preview.
        </p>
        <button disabled aria-describedby="apply-unavailable">
          Apply
        </button>{' '}
        <button onClick={close}>Keep and close</button>
      </dialog>
    </>
  )
}
