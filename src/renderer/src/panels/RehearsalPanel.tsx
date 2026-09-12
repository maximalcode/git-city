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
      {report.diagnostics && <p role="alert">⚠ {report.diagnostics}</p>}
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
          <p>
            ⚠ Tracked edits are initially replayed as unstaged changes; the original staging
            selection is not restored.
          </p>
          {report.carried.conflicts.map((path) => (
            <p key={path}>⚠ Carried-work conflict: {path}</p>
          ))}
        </>
      )}
      <p>
        Untracked files are not represented as carried work. Previews run in the retained sandbox.
      </p>
    </>
  )
}

export default function RehearsalPanel(): React.JSX.Element | null {
  const [availability, setAvailability] = useState({
    configured: false,
    available: false,
    message: ''
  })
  const { configured, available } = availability
  const [confirmApply, setConfirmApply] = useState<RehearsalReport | null>(null)
  const applyTrigger = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const cancelApply = useRef<HTMLButtonElement>(null)
  const [target, setTarget] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const recoveryHeading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const repo = useStore((s) => s.repoPath)
  const open = useStore((s) => s.rehearsalOpen)
  const busy = useStore((s) => s.rehearsalBusy)
  const result = useStore((s) => (repo ? s.rehearsalResults[repo] : undefined))
  const confirming = result?.kind === 'report' && confirmApply === result.report
  const recovery = useStore((s) => (repo ? s.rehearsalRecovery[repo] : undefined))
  const application = useStore((s) =>
    result?.kind === 'report' ? s.rehearsalApplications[result.report.id] : undefined
  )
  const checkRecovery = useStore((s) => s.checkRehearsalRecovery)
  const apply = useStore((s) => s.applyRehearsal)
  const recover = useStore((s) => s.recoverRehearsal)
  const blocked = recovery && recovery.state !== 'none'
  const openPanel = useStore((s) => s.openRehearsal)
  const close = useStore((s) => s.closeRehearsal)
  const rehearse = useStore((s) => s.rehearseMerge)

  useEffect(() => {
    if (blocked) recoveryHeading.current?.focus()
  }, [blocked])
  useEffect(() => {
    void checkRecovery()
  }, [repo, checkRecovery])
  useEffect(() => {
    if (confirming) cancelApply.current?.focus()
    else if (wasConfirming.current) applyTrigger.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])
  useEffect(() => {
    if (application && !busy) status.current?.focus()
  }, [application, busy])
  useEffect(() => {
    // There is no public entry point, even when a packaged app inherits the env var.
    if (!import.meta.env.DEV) return
    void bridge()
      ?.rehearsalAvailability()
      .then(setAvailability)
      .catch(() =>
        setAvailability({
          configured: false,
          available: false,
          message: 'Could not check Rehearse availability.'
        })
      )
  }, [])
  useEffect(() => {
    if (open && configured && repo) {
      dialog.current?.showModal()
      input.current?.focus()
    } else {
      dialog.current?.close()
      if (configured) trigger.current?.focus()
    }
  }, [open, configured, repo])
  useEffect(() => {
    if (result && open && !busy) status.current?.focus()
  }, [result, open, busy])

  if (!repo) return null
  return (
    <>
      {blocked && (
        <section role="alert" aria-label="Mandatory recovery">
          <h2 ref={recoveryHeading} tabIndex={-1}>
            ⚠ Recovery required
          </h2>
          <p>{recovery.message}</p>
          <p>Worktree: {repo}</p>
          {recovery.rehearsal && <p>Rehearsal: {recovery.rehearsal}</p>}
          <p>
            Other worktrees in this repository are also blocked. Preserve external changes; no
            generic repair is safe.
          </p>
          {recovery.can_complete && (
            <button disabled={busy} onClick={() => void recover(recovery.rehearsal!, 'complete')}>
              Complete interrupted {recovery.operation}
            </button>
          )}
          {recovery.can_rollback && (
            <button disabled={busy} onClick={() => void recover(recovery.rehearsal!, 'rollback')}>
              Roll back interrupted {recovery.operation}
            </button>
          )}
          <button disabled={busy} onClick={() => void checkRecovery()}>
            Check recovery status
          </button>
        </section>
      )}
      {configured && (
        <button
          ref={trigger}
          className="rehearsal-trigger"
          onClick={() => {
            setConfirmApply(null)
            openPanel()
          }}
        >
          Rehearse (internal)
        </button>
      )}
      <dialog
        ref={dialog}
        className="rehearsal-dialog"
        aria-labelledby="rehearsal-title"
        onKeyDown={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.preventDefault()
          if (confirming) setConfirmApply(null)
          else close()
        }}
      >
        <h2 id="rehearsal-title">Rehearse merge</h2>
        <p>
          Internal development preview. Closing keeps the rehearsal; it does not stop a running
          merge.
        </p>
        {!available && <p role="alert">⚠ {availability.message}</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (available && !busy && !blocked) void rehearse(target)
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
            disabled={busy || !!blocked || confirming || !available}
            required
          />
          <button
            type="submit"
            disabled={busy || !!blocked || confirming || !available || !target.trim()}
          >
            {busy ? 'Rehearsing…' : 'Rehearse'}
          </button>
        </form>
        <div ref={status} tabIndex={-1} aria-live="polite" aria-busy={busy}>
          {application && <p role="status">{application.message}</p>}
          {blocked && <p role="alert">⚠ {recovery.message} Close this panel to access recovery.</p>}
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
        {confirming && result?.kind === 'report' ? (
          <section aria-label="Confirm Apply">
            <h3>Apply rehearsal</h3>
            <p>
              Apply {result.report.command.join(' ')} to {result.report.origin_worktree}, checkout{' '}
              {result.report.checkout.target}.
            </p>
            <p>Affected branches: {result.report.refs.map((ref) => ref.name).join(', ')}</p>
            <p>
              Tracked local work:{' '}
              {result.report.carried
                ? `${result.report.carried.status}: ${result.report.carried.paths.join(', ')}`
                : 'None carried'}
              . Untracked files are not carried.
            </p>
            <p>
              Tracked edits are initially replayed as unstaged changes. The backend will check the
              worktree, local work and branch occupancy again.
            </p>
            <button ref={cancelApply} onClick={() => setConfirmApply(null)}>
              Cancel Apply
            </button>
            <button
              disabled={busy || !!blocked}
              onClick={() => {
                setConfirmApply(null)
                void apply(result.report)
              }}
            >
              Apply rehearsal
            </button>
          </section>
        ) : (
          <button
            ref={applyTrigger}
            disabled={
              busy ||
              !!blocked ||
              !recovery ||
              !!application ||
              result?.kind !== 'report' ||
              result.report.can_apply !== true ||
              result.report.refs.length === 0
            }
            onClick={() => setConfirmApply(result?.kind === 'report' ? result.report : null)}
          >
            Apply
          </button>
        )}{' '}
        <button onClick={close}>Keep and close</button>
      </dialog>
    </>
  )
}
