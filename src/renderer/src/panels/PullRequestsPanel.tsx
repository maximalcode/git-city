import { useState } from 'react'
import type { PullRequestInfo } from '../../../shared/types'
import { useStore } from '../store'

const CI_LABEL: Record<PullRequestInfo['ci'], string> = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks running',
  none: 'no checks'
}

/**
 * GitHub pull requests for the repo, via the `gh` CLI (no token setup — gh owns
 * the auth). Lists open PRs with rolled-up CI state, highlights the current
 * branch's PR, and lets you check one out, open it in the browser, or create a
 * PR for the current branch.
 */
export default function PullRequestsPanel(): React.JSX.Element | null {
  const open = useStore((s) => s.prPanelOpen)
  const setOpen = useStore((s) => s.setPrPanelOpen)
  const auth = useStore((s) => s.githubAuth)
  const prs = useStore((s) => s.pullRequests)
  const currentPr = useStore((s) => s.currentPr)
  const loading = useStore((s) => s.prLoading)
  const status = useStore((s) => s.workingStatus)
  const busy = useStore((s) => s.opInProgress !== null)
  const refreshGitHub = useStore((s) => s.refreshGitHub)
  const checkoutPr = useStore((s) => s.checkoutPr)
  const createPr = useStore((s) => s.createPr)
  const openExternal = useStore((s) => s.openExternal)
  const reviewPrInCity = useStore((s) => s.reviewPrInCity)

  const branch = status?.branch ?? null
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('main')

  if (!open) return null

  const canCreate =
    !!auth?.authed && auth.isGitHub && !currentPr && !!branch && status?.upstream != null && !busy

  const submitCreate = (): void => {
    const t = title.trim() || (branch ?? '')
    if (!t) return
    void createPr(base.trim() || 'main', t, body.trim())
    setTitle('')
    setBody('')
  }

  return (
    <div className="side-panel pr-panel">
      <div className="panel-head">
        <span>Pull Requests</span>
        <div className="pr-head-actions">
          <button className="pr-refresh" disabled={loading} onClick={() => void refreshGitHub()}>
            ↻
          </button>
          <button className="close" aria-label="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        {loading && prs.length === 0 && <div className="empty">Loading pull requests…</div>}

        {!loading && auth && (!auth.authed || !auth.isGitHub) && (
          <div className="pr-unavailable">
            <p>{auth.reason}</p>
            {!auth.available && (
              <p className="pr-hint">
                Install it from <span className="mono">cli.github.com</span>, then run{' '}
                <span className="mono">gh auth login</span>.
              </p>
            )}
            {auth.available && !auth.authed && (
              <p className="pr-hint">
                Run <span className="mono">gh auth login</span> in a terminal, then refresh.
              </p>
            )}
          </div>
        )}

        {auth?.authed && auth.isGitHub && (
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
                  <span>Create PR from {branch}</span>
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
                      value={base}
                      onChange={(e) => setBase(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={busy} onClick={submitCreate}>
                    Create pull request
                  </button>
                </div>
              </section>
            )}

            {!currentPr && !canCreate && branch && status?.upstream == null && (
              <div className="pr-hint pr-pad">
                Publish this branch (push) to open a pull request for it.
              </div>
            )}

            <section>
              <div className="section-head">
                <span>Open ({prs.length})</span>
              </div>
              {prs.length === 0 && !loading && <div className="empty">No open pull requests</div>}
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
          title="Light up this PR's files in the city"
        >
          Review in city
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
