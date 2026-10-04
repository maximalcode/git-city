import type { RehearsalReport } from '../../../shared/types'

export default function RehearsalReportView({
  report
}: {
  report: RehearsalReport
}): React.JSX.Element {
  const action =
    { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick' }[report.command[0]] ??
    'Git action'
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
          clean: `${action} preview completed`,
          stopped: `${action} stopped`,
          failed: `Git could not complete the ${action.toLowerCase()}`,
          incomplete: `${action} execution is incomplete`
        }[report.outcome]
  return (
    <>
      <h3 tabIndex={-1}>{status}</h3>
      {report.outcome === 'incomplete' && (
        <p role="alert">
          ⚠ Execution was interrupted. Retained work is available for reference; Apply and automatic
          continuation are unavailable.
        </p>
      )}
      {report.diagnostics && <p role="alert">⚠ {report.diagnostics}</p>}
      {report.drift_unexpected && (
        <p role="alert">⚠ Unexpected content changes — review the affected files carefully.</p>
      )}
      <p className="rehearsal-summary">
        {report.refs.length} branch/commit movements ·{' '}
        {new Set(report.drift.flatMap((drift) => drift.files.map((file) => file.path))).size}{' '}
        changed files reported
      </p>
      {report.refs.length > 0 && (
        <ul className="rehearsal-movements">
          {report.refs.slice(0, 3).map((ref) => (
            <li key={ref.name}>
              <strong>{ref.name.replace(/^refs\/heads\//, '')}</strong>
              <code>
                {ref.before?.slice(0, 7) ?? '(new)'} → {ref.after?.slice(0, 7) ?? '(deleted)'}
              </code>
            </li>
          ))}
        </ul>
      )}
      <details className="rehearsal-review">
        <summary>Review changes</summary>
        {report.plan && (
          <section aria-label="Rehearsed plan">
            <h4>Interactive plan · newest → oldest</h4>
            <p>Base: {report.plan.base ?? 'Root'}</p>
            <ol>
              {report.plan.entries.map((entry) => (
                <li key={entry.hash}>
                  {entry.action} {entry.hash} {entry.subject}
                </li>
              ))}
            </ol>
          </section>
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
      </details>
      {report.conflicts.length > 0 && (
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
    </>
  )
}

export function RehearsalDetails({ report }: { report: RehearsalReport }): React.JSX.Element {
  return (
    <details>
      <summary>Technical details</summary>
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
      <section aria-label="Execution conditions">
        <h4>Execution conditions</h4>
        <p>
          {report.repository_hooks === 'disabled'
            ? '⚠ Repository hooks were not run. Apply also skips hooks; Off keeps direct Git hooks.'
            : '⚠ Hook execution information unavailable from this report. Off keeps direct Git hooks.'}
        </p>
        <p>A clean Git result does not guarantee correct content.</p>
        <p>
          {report.rerere_resolution_transfer === 'sandbox_only'
            ? '⚠ Existing rerere conflict resolutions are used as an isolated copy. Newly learned sandbox resolutions are not written back to the original cache, including on Apply.'
            : '⚠ rerere resolution transfer information unavailable from this report.'}
        </p>
        <p>
          Signing settings are preserved. System signing dialogs may open; terminal editors are
          disabled. Git City does not store secret keys. Apply preserves the reviewed commit
          objects.
        </p>
        <h4>Commit signatures</h4>
        <p>
          Signature presence does not establish validity or signer trust. Neither is verified here.
        </p>
        {!report.signatures ? (
          <p>Signature information unavailable from this report.</p>
        ) : report.signatures.length === 0 ? (
          <p>No resulting commits reported for signature inspection.</p>
        ) : (
          <ul>
            {report.signatures.map((signature) => (
              <li key={signature.sha}>
                <code>{signature.sha}</code>:{' '}
                {signature.present ? 'Signature present' : 'Signature missing'}
                {' · '}Verification: not checked · Signer trust: not checked
              </li>
            ))}
          </ul>
        )}
      </section>
      <p>
        Untracked files are not represented as carried work. Previews run in the retained sandbox.
      </p>
      <p>
        Sandbox: <code>{report.sandbox ?? 'Not reported'}</code>
      </p>
    </details>
  )
}
