import { useState } from 'react'
import type { HostAuth, PullRequestInfo } from '../../../shared/types'
import { useStore } from '../store'
import { getMode } from '../city/modes'

const CI_LABEL: Record<PullRequestInfo['ci'], string> = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks running',
  none: 'no checks'
}

/**
 * Pull requests for the repo, via the host's own CLI (no token setup — `gh` and
 * `glab` own the auth). Lists open PRs with rolled-up CI state, highlights the
 * current branch's PR, and lets you check one out, open it in the browser, or
 * create a PR for the current branch.
 *
 * GitLab merge requests come through the same model; only the wording below
 * follows the host, so nothing downstream learns a second vocabulary.
 */

/** Host-specific wording — the model stays PR-shaped either way. */
const VOCAB = {
  github: {
    plural: 'Pull Requests',
    lower: 'pull requests',
    one: 'pull request',
    short: 'PR',
    cli: 'gh',
    install: 'cli.github.com',
    login: 'gh auth login'
  },
  gitlab: {
    plural: 'Merge Requests',
    lower: 'merge requests',
    one: 'merge request',
    short: 'MR',
    cli: 'glab',
    install: 'gitlab.com/gitlab-org/cli',
    login: 'glab auth login'
  }
} as const

/**
 * What to suggest for a HostAuth. Providers set `hint` where the cause is
 * known; the fallback reproduces the old available/authed reading for anything
 * that predates it.
 */
function hintOf(auth: HostAuth): NonNullable<HostAuth['hint']> {
  if (auth.hint) return auth.hint
  if (!auth.available) return 'install'
  if (!auth.authed) return 'login'
  return 'none'
}

export default function PullRequestsPanel(): React.JSX.Element | null {
  const open = useStore((s) => s.prPanelOpen)
  const setOpen = useStore((s) => s.setPrPanelOpen)
  const auth = useStore((s) => s.hostAuth)
  const prs = useStore((s) => s.pullRequests)
  const truncated = useStore((s) => s.prsTruncated)
  const hostError = useStore((s) => s.hostError)
  const currentPr = useStore((s) => s.currentPr)
  const loading = useStore((s) => s.prLoading)
  const status = useStore((s) => s.workingStatus)
  const busy = useStore((s) => s.opInProgress !== null)
  const refreshHost = useStore((s) => s.refreshHost)
  const checkoutPr = useStore((s) => s.checkoutPr)
  const createPr = useStore((s) => s.createPr)
  const openExternal = useStore((s) => s.openExternal)
  const reviewPrInCity = useStore((s) => s.reviewPrInCity)

  const branch = status?.branch ?? null
  const words = VOCAB[auth?.host === 'gitlab' ? 'gitlab' : 'github']
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  // Empty, not 'main'. Both providers omit the flag when base is blank and the
  // forge then uses the repository's own default branch — hardcoding 'main'
  // produced a raw GraphQL error on every master/develop repo, and the panel's
  // own base field a few pixels away never said it was the cause (#24).
  const [base, setBase] = useState('')

  if (!open) return null

  const canCreate =
    !!auth?.authed && auth.isRepo && !currentPr && !!branch && status?.upstream != null && !busy

  const submitCreate = (): void => {
    const t = title.trim() || (branch ?? '')
    if (!t) return
    void createPr(base.trim(), t, body.trim())
    setTitle('')
    setBody('')
  }

  return (
    <div className="side-panel pr-panel">
      <div className="panel-head">
        <span>{words.plural}</span>
        <div className="pr-head-actions">
          {/* never disabled: the loading state is exactly what gets stuck, and
              greying out the only retry control made that unrecoverable (#24) */}
          <button className="pr-refresh" title="Refresh" onClick={() => void refreshHost()}>
            ↻
          </button>
          <button className="close" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        {loading && prs.length === 0 && !hostError && (
          <div className="empty">{`Loading ${words.lower}…`}</div>
        )}

        {/* A caught IPC error used to be swallowed, leaving this panel entirely
            blank — no message, no empty state, and a ↻ that visibly did
            nothing (#24). */}
        {hostError && (
          <div className="pr-unavailable">
            <p>{hostError}</p>
            <p className="pr-hint">Press ↻ to try again.</p>
          </div>
        )}

        {!loading && !hostError && auth && (!auth.authed || !auth.isRepo) && (
          <div className="pr-unavailable">
            <p>{auth.reason}</p>
            {/* The hint comes from where the cause is known. Deriving it here
                from available/authed is what told an offline user to re-run
                gh auth login, and a self-hosted GitLab user to install gh. */}
            {hintOf(auth) === 'install' && auth.host !== 'unknown' && (
              <p className="pr-hint">
                Install it from <span className="mono">{words.install}</span>, then run{' '}
                <span className="mono">{words.login}</span>.
              </p>
            )}
            {hintOf(auth) === 'login' && (
              <p className="pr-hint">
                Run <span className="mono">{words.login}</span> in a terminal, then press ↻.
              </p>
            )}
            {hintOf(auth) === 'retry' && <p className="pr-hint">Press ↻ to try again.</p>}
            {hintOf(auth) === 'none' && auth.host === 'unknown' && (
              <p className="pr-hint">
                Pull requests appear here for repositories hosted on GitHub or GitLab.
              </p>
            )}
          </div>
        )}

        {auth?.authed && auth.isRepo && (
          <>
            {currentPr && (
              <section>
                <div className="section-head">
                  <span>This branch</span>
                </div>
                <PrRow
                  pr={currentPr}
                  current
                  onOpen={openExternal}
                  onCheckout={checkoutPr}
                  onReview={reviewPrInCity}
                  busy={busy}
                />
              </section>
            )}

            {canCreate && (
              <section className="pr-create">
                <div className="section-head">
                  <span>
                    Create {words.short} from {branch}
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="Title (defaults to branch name)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  placeholder="Description (optional)"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="pr-create-row">
                  <label>
                    base
                    <input
                      type="text"
                      className="pr-base"
                      placeholder="default branch"
                      value={base}
                      onChange={(e) => setBase(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={busy} onClick={submitCreate}>
                    {`Create ${words.one}`}
                  </button>
                </div>
              </section>
            )}

            {!currentPr && !canCreate && branch && status?.upstream == null && (
              <div className="pr-hint pr-pad">
                {`Publish this branch (push) to open a ${words.one} for it.`}
              </div>
            )}

            <section>
              <div className="section-head">
                {/* the cap used to be presented as the complete list (#24) */}
                <span>
                  Open ({truncated ? `${prs.length}+, showing first ${prs.length}` : prs.length})
                </span>
              </div>
              {prs.length === 0 && !loading && (
                <div className="empty">{`No open ${words.lower}`}</div>
              )}
              {prs
                .filter((pr) => pr.number !== currentPr?.number)
                .map((pr) => (
                  <PrRow
                    key={pr.number}
                    pr={pr}
                    current={false}
                    onOpen={openExternal}
                    onCheckout={checkoutPr}
                    onReview={reviewPrInCity}
                    busy={busy}
                  />
                ))}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function PrRow({
  pr,
  current,
  onOpen,
  onCheckout,
  onReview,
  busy
}: {
  pr: PullRequestInfo
  current: boolean
  onOpen: (url: string) => void
  onCheckout: (n: number) => void
  onReview: (n: number, title: string) => void
  busy: boolean
}): React.JSX.Element {
  // "Review in city" was still the label with a farm on screen
  const noun = getMode(useStore((s) => s.viewMode)).noun
  return (
    <div className={`pr-row ${current ? 'current' : ''}`}>
      <div className="pr-main">
        <span className={`ci-dot ci-${pr.ci}`} title={CI_LABEL[pr.ci]} />
        <span className="pr-title" title={pr.title}>
          {pr.title}
        </span>
      </div>
      <div className="pr-sub">
        <span className="pr-num">#{pr.number}</span>
        <span className="pr-refs">
          {pr.headRef} → {pr.baseRef}
        </span>
        {pr.isDraft && <span className="pr-draft">draft</span>}
        <span className="pr-author">{pr.author}</span>
      </div>
      <div className="pr-actions">
        <button
          onClick={() => onReview(pr.number, pr.title)}
          title={`Light up this PR's files in the ${noun}`}
        >
          Review in {noun}
        </button>
        {!current && (
          <button disabled={busy} onClick={() => onCheckout(pr.number)}>
            Checkout
          </button>
        )}
        <button onClick={() => onOpen(pr.url)}>Open ↗</button>
      </div>
    </div>
  )
}
