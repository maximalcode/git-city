import RehearsalReportView, { RehearsalDetails } from './RehearsalReportView'
import RehearsalCityComparison from './RehearsalCityComparison'
import RehearsalUndo from './RehearsalUndo'
import RehearsalMode from './RehearsalMode'
import RehearsalHistory from './RehearsalHistory'
import RehearsalConflicts from './RehearsalConflicts'
import RehearsalReviewPanel from './RehearsalReviewPanel'
import { registerRehearsalNavigationGuard } from './rehearsalNavigation'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { bridge } from '../lib/bridge'
import type { RehearsalReport } from '../../../shared/types'

export default function RehearsalPanel(): React.JSX.Element | null {
  const [availability, setAvailability] = useState({
    configured: false,
    available: false,
    message: ''
  })
  const modeSetting = useStore((s) => s.rehearsalModeSetting)
  const configured = availability.configured || !!modeSetting
  const available = availability.available
  const [confirmApply, setConfirmApply] = useState<RehearsalReport | null>(null)
  const [conflictDirty, setConflictDirty] = useState(false)
  const conflictAbandon = useRef<(() => Promise<boolean>) | null>(null)
  const conflictPrepare = useRef<(() => Promise<boolean>) | null>(null)
  const applyTrigger = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const cancelApply = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState({ context: '', value: '' })
  const returnFocus = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  const submit = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const confirmation = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const wasBlocked = useRef(false)
  const recoveryHeading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const repo = useStore((s) => s.repoPath)
  const open = useStore((s) => s.rehearsalOpen)
  const request = useStore((s) => s.rehearsalRequest)
  const selected = request?.repo === repo ? request : null
  const busy = useStore((s) => s.rehearsalBusy)
  const result = useStore((s) => (repo ? s.rehearsalResults[repo] : undefined))
  const report = result?.kind === 'report' ? result.report : null
  const action =
    (report?.command[0] as 'merge' | 'rebase' | 'cherry-pick' | undefined) ??
    selected?.action ??
    'merge'
  const context = `${repo}:${selected ? `${selected.action}:${selected.target}` : (report?.id ?? 'merge')}`
  const chosenTarget =
    selected?.target ??
    (draft.context === context
      ? draft.value
      : report?.plan
        ? (report.plan.base ?? 'root')
        : (report?.command.at(-1) ?? ''))
  const branch = useStore((s) => s.workingStatus?.branch)
  const executionRepo = useStore((s) => s.rehearsalExecutionRepo)
  const stopping = useStore((s) => s.rehearsalStopping)
  const stop = useStore((s) => s.stopRehearsal)
  const inventory = useStore((s) => (repo ? s.rehearsalInventories[repo] : undefined))
  const managementMessage = useStore((s) =>
    repo ? s.rehearsalManagementMessages[repo] : undefined
  )
  const running = executionRepo === repo
  const shownTarget = running ? chosenTarget : (report?.command.at(-1) ?? chosenTarget)
  const interactive = !!(report?.plan || selected?.plan || report?.command.includes('-i'))
  const missingPlan = interactive && !(selected?.plan ?? report?.plan)
  const confirming = result?.kind === 'report' && confirmApply === result.report
  const recovery = useStore((s) => (repo ? s.rehearsalRecovery[repo] : undefined))
  const application = useStore((s) =>
    repo && result?.kind === 'report'
      ? s.rehearsalApplications[repo]?.[result.report.id]
      : undefined
  )
  const checkRecovery = useStore((s) => s.checkRehearsalRecovery)
  const apply = useStore((s) => s.applyRehearsal)
  const recover = useStore((s) => s.recoverRehearsal)
  const blocked = recovery && recovery.state !== 'none'
  const openPanel = useStore((s) => s.openRehearsal)
  const close = useStore((s) => s.closeRehearsal)
  const rehearse = useStore((s) => s.rehearse)
  const guardConflictNavigation = async (action: string): Promise<boolean> => {
    if (!conflictDirty) {
      return true
    }
    const ready = conflictPrepare.current ? await conflictPrepare.current() : false
    if (ready) return true
    if (!window.confirm(`This conflict draft could not be saved. Abandon it and ${action}?`))
      return false
    const abandoned = conflictAbandon.current ? await conflictAbandon.current() : false
    if (!abandoned) return false
    setConflictDirty(false)
    return true
  }
  const requestClose = async (): Promise<void> => {
    if (!(await guardConflictNavigation('close the rehearsal panel'))) return
    close()
  }
  const navigationGuard = useRef(guardConflictNavigation)
  navigationGuard.current = guardConflictNavigation
  useEffect(() => registerRehearsalNavigationGuard((action) => navigationGuard.current(action)), [])

  useEffect(() => {
    if (blocked) recoveryHeading.current?.focus()
    else if (wasBlocked.current) trigger.current?.focus()
    wasBlocked.current = !!blocked
  }, [blocked])
  useEffect(() => {
    void checkRecovery()
  }, [repo, checkRecovery])
  useEffect(() => {
    if (confirming && open) {
      confirmation.current?.showModal()
      cancelApply.current?.focus()
    } else confirmation.current?.close()
    if (confirming) cancelApply.current?.focus()
    else if (wasConfirming.current) applyTrigger.current?.focus()
    wasConfirming.current = confirming
  }, [confirming, open])
  useEffect(() => {
    void bridge()
      ?.rehearsalAvailability()
      .then((value) => {
        setAvailability(value)
        useStore.setState({ rehearsalConfigured: value.configured })
      })
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
      if (!wasOpen.current) {
        returnFocus.current = document.activeElement as HTMLElement | null
        if (blocked || busy || result) heading.current?.focus()
        else if (selected) submit.current?.focus()
        else input.current?.focus()
      }
      wasOpen.current = true
    } else {
      if (wasOpen.current) {
        if (returnFocus.current?.isConnected) returnFocus.current.focus()
        else trigger.current?.focus()
      }
      wasOpen.current = false
    }
  }, [open, configured, repo, selected, blocked, busy, result])
  const previousStatus = useRef({ result, application })
  useEffect(() => {
    // Announce new results without taking focus from the city or child workflows.
    if (busy) return
    const changed =
      previousStatus.current.result !== result || previousStatus.current.application !== application
    previousStatus.current = { result, application }
    if (
      changed &&
      open &&
      panel.current?.contains(document.activeElement) &&
      !document.activeElement?.closest('[aria-label="Undo Apply"]')
    )
      status.current?.focus()
  }, [result, application, open, busy])
  const applyReason = busy
    ? 'Wait for the current operation to finish.'
    : blocked
      ? 'Recovery is required before Apply.'
      : !recovery
        ? 'Checking recovery status…'
        : application
          ? 'This Apply attempt has finished. Inspect its result above before rehearsing again.'
          : !report
            ? 'Run a rehearsal to review its result before Apply.'
            : report.outcome !== 'clean' || report.conflicted
              ? 'Apply requires a completed, conflict-free result.'
              : report.refs.length === 0
                ? 'No branch changes to apply.'
                : report.can_apply !== true
                  ? 'This retained result is not eligible for Apply. Rehearse again against the current checkout.'
                  : null
  const stale = inventory?.entries.find((entry) => entry.id === report?.id)?.stale

  if (!repo) return null
  return (
    <>
      <RehearsalMode />
      {blocked && (
        <section className="rehearsal-recovery" role="alert" aria-label="Mandatory recovery">
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
          aria-expanded={open}
          aria-controls="rehearsal-panel"
          onClick={() => {
            setConfirmApply(null)
            openPanel()
          }}
        >
          Rehearse panel
        </button>
      )}
      {open && configured && (
        <aside
          ref={panel}
          id="rehearsal-panel"
          className="rehearsal-panel"
          aria-labelledby="rehearsal-title"
          onKeyDown={(event) => {
            event.stopPropagation()
            // Native confirmation dialogs own Escape and their cancel event.
            if ((event.target as HTMLElement).closest('dialog[open]')) return
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault()
              if (confirming) setConfirmApply(null)
              else void requestClose()
            }
          }}
        >
          <header className="rehearsal-header">
            <p className="rehearsal-eyebrow">Preview changes</p>
            <div className="rehearsal-title-row">
              <h2 id="rehearsal-title" ref={heading} tabIndex={-1}>
                Rehearse {interactive ? 'interactive rebase' : action}
              </h2>
              <button aria-label="Close rehearsal panel" onClick={() => void requestClose()}>
                ×
              </button>
            </div>
            <dl className="rehearsal-direction">
              <div>
                <dt>
                  {report
                    ? report.checkout.kind === 'detached'
                      ? 'Rehearsed checkout'
                      : 'Rehearsed branch'
                    : branch
                      ? 'Current branch'
                      : 'Current checkout'}
                </dt>
                <dd>{report?.checkout.target ?? branch ?? 'Detached HEAD'}</dd>
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <dt>
                  {interactive
                    ? 'Plan base'
                    : action === 'rebase'
                      ? 'Rebase onto'
                      : action === 'cherry-pick'
                        ? 'Pick commit'
                        : 'Merge from'}
                </dt>
                <dd>{shownTarget === '--root' ? 'Root' : shownTarget || 'Choose a target'}</dd>
              </div>
            </dl>
          </header>
          <div className="rehearsal-body">
            {!available && <p role="alert">⚠ {availability.message}</p>}
            <div ref={status} tabIndex={-1} aria-live="polite" aria-busy={busy}>
              {busy && (
                <>
                  <h3>{running ? 'Rehearsal running' : 'Working…'}</h3>
                  <p>
                    {running
                      ? 'Trying the operation in a separate sandbox. Your current checkout stays unchanged.'
                      : 'Waiting for the current operation to finish.'}
                  </p>
                </>
              )}
              {executionRepo && !running && (
                <p role="status">
                  A rehearsal is running in {executionRepo}. Open that worktree to inspect it.
                </p>
              )}
              {managementMessage && <p role="status">{managementMessage}</p>}
              {stale && (
                <p role="alert">
                  ⚠ This rehearsal has an outdated checkout or ref basis. Apply will check the real
                  state again; rehearse again if refused.
                </p>
              )}
              {inventory?.lowSpace && (
                <p role="alert">
                  ⚠ Low disk space (less than 1 GiB available). Review saved rehearsals and discard
                  unneeded work.
                </p>
              )}
              {inventory?.warning && <p role="alert">⚠ {inventory.warning}</p>}
              {application && <p role="status">{application.message}</p>}
              {blocked && (
                <p role="alert">
                  ⚠ {recovery.message} Recovery controls remain available beside this panel.
                </p>
              )}
              {!busy &&
                (result?.kind === 'report' ? (
                  <>
                    <RehearsalReviewPanel report={result.report} />
                    <RehearsalReportView report={result.report} />
                  </>
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
                ))}
            </div>
            {open && result?.kind === 'report' && (
              <RehearsalCityComparison report={result.report} />
            )}
            {result?.kind === 'report' && result.report.outcome === 'stopped' && (
              <RehearsalConflicts
                key={`${repo}:${result.report.id}`}
                report={result.report}
                blocked={!!blocked}
                onDirtyStateChange={setConflictDirty}
                onAbandonAvailable={(abandon) => {
                  conflictAbandon.current = abandon
                }}
                onPrepareNavigationAvailable={(prepare) => {
                  conflictPrepare.current = prepare
                }}
              />
            )}
            <details
              className="rehearsal-setup"
              open={!report && !busy}
              key={report?.id ?? 'setup'}
            >
              <summary>{report ? 'Rehearse again' : 'Choose rehearsal target'}</summary>
              <form
                id="rehearsal-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (available && !busy && !blocked && !missingPlan) {
                    status.current?.focus()
                    void rehearse(action, chosenTarget, selected?.plan ?? report?.plan)
                  }
                }}
              >
                <label htmlFor="rehearsal-target">
                  {interactive
                    ? 'Interactive plan base (Root includes the root commit)'
                    : action === 'rebase'
                      ? 'Rebase current checkout onto selected branch'
                      : action === 'cherry-pick'
                        ? 'Selected commit to cherry-pick'
                        : 'Branch or commit to merge into the current checkout'}
                </label>
                {missingPlan && (
                  <p role="alert">
                    Open the interactive rebase editor to prepare a new plan. This retained report
                    has no saved plan to replay.
                  </p>
                )}
                <input
                  id="rehearsal-target"
                  ref={input}
                  value={chosenTarget}
                  readOnly={!!selected || interactive}
                  onChange={(event) => setDraft({ context, value: event.target.value })}
                  disabled={busy || !!blocked || confirming || !available}
                  required
                />
                <button
                  ref={submit}
                  type="submit"
                  disabled={
                    busy ||
                    !!blocked ||
                    confirming ||
                    !available ||
                    missingPlan ||
                    !chosenTarget.trim()
                  }
                >
                  {busy ? 'Working…' : 'Rehearse'}
                </button>
              </form>
            </details>
            <details className="rehearsal-history">
              <summary>Saved rehearsals{inventory ? ` · ${inventory.entries.length}` : ''}</summary>
              <RehearsalHistory
                key={repo}
                repo={repo}
                onBeforeSelect={() => guardConflictNavigation('switch rehearsals')}
              />
            </details>
            <RehearsalUndo key={`undo:${repo}`} repo={repo} blocked={!!blocked} />
            {report && <RehearsalDetails report={report} />}
          </div>
          <footer className="rehearsal-footer">
            <p>
              {running
                ? 'Closing keeps this rehearsal running in the background. Stop ends execution and reloads its actual state; continuation may be unavailable.'
                : (applyReason ??
                  (report?.repository_hooks === 'disabled'
                    ? 'Hooks were not run. Review changes before applying.'
                    : 'Hook execution information unavailable. Review changes before applying.'))}
            </p>
            <div className="rehearsal-actions">
              {running && (
                <button
                  disabled={stopping}
                  onClick={() => {
                    status.current?.focus()
                    void stop()
                  }}
                >
                  {stopping ? 'Stopping…' : 'Stop rehearsal'}
                </button>
              )}
              <button onClick={() => void requestClose()}>
                {running ? 'Keep and close' : 'Keep for later'}
              </button>
              {!running && report && (
                <button
                  className="primary"
                  ref={applyTrigger}
                  disabled={!!applyReason}
                  onClick={() => setConfirmApply(report)}
                >
                  Apply
                </button>
              )}
            </div>
          </footer>
          <dialog
            ref={confirmation}
            className="rehearsal-dialog"
            aria-label="Confirm Apply"
            onCancel={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setConfirmApply(null)
            }}
          >
            {confirming && result?.kind === 'report' && (
              <section aria-label="Confirm Apply">
                <h3>Apply rehearsal</h3>
                <p>
                  Apply {result.report.command.join(' ')} to {result.report.origin_worktree},
                  checkout {result.report.checkout.target}.
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
                  Tracked edits are initially replayed as unstaged changes. The backend will check
                  the worktree, local work and branch occupancy again.
                </p>
                <button ref={cancelApply} onClick={() => setConfirmApply(null)}>
                  Cancel Apply
                </button>
                <button
                  disabled={busy || !!blocked}
                  onClick={() => {
                    confirmation.current?.close()
                    status.current?.focus()
                    setConfirmApply(null)
                    void apply(result.report)
                  }}
                >
                  Apply rehearsal
                </button>
              </section>
            )}
          </dialog>
        </aside>
      )}
    </>
  )
}
