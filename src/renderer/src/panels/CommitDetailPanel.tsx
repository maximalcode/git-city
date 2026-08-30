import { useMemo } from 'react'
import type { CommitDetail } from '../../../shared/types'
import { useStore } from '../store'
import { useRepoQuery } from '../lib/repoQuery'
import { formatDate } from '../lib/format'

const SIG_LABEL: Record<CommitDetail['verification'], string | null> = {
  good: 'Verified',
  bad: 'Bad signature',
  unknown: 'Unverified',
  none: null
}

/**
 * Detail for one commit, opened from a commit search hit. Shows the header,
 * signature state and the files it changed; clicking a file opens that commit's
 * diff for it. Decoupled from the 50-snapshot sampling, so *any* commit works —
 * with a "fly the city here" shortcut when the commit is a sampled snapshot.
 */
export default function CommitDetailPanel(): React.JSX.Element | null {
  const hash = useStore((s) => s.commitDetailHash)
  const repoPath = useStore((s) => s.repoPath)
  const analysis = useStore((s) => s.analysis)
  const closeCommit = useStore((s) => s.closeCommit)
  const setSelected = useStore((s) => s.setSelected)
  const setDiffOpen = useStore((s) => s.setDiffOpen)
  const setSnapshotIndex = useStore((s) => s.setSnapshotIndex)
  const askConfirm = useStore((s) => s.askConfirm)
  const cherryPick = useStore((s) => s.cherryPick)
  const branch = useStore((s) => s.workingStatus?.branch ?? null)

  const {
    data: detail,
    loading,
    error
  } = useRepoQuery(hash && repoPath ? ([repoPath, hash] as const) : null, (api, [repo, h]) =>
    api.commitDetail(repo, h)
  )

  // is this commit one of the sampled snapshots? → offer to fly there
  const snapshotIndex = useMemo(() => {
    if (!hash || !analysis) return -1
    return analysis.snapshots.findIndex((s) => s.hash === hash)
  }, [hash, analysis])

  if (!hash) return null

  const openFile = (path: string): void => {
    setSelected(path)
    setDiffOpen(true, hash)
  }

  return (
    <div className="side-panel commit-detail">
      <div className="panel-head">
        <span className="panel-title">Commit</span>
        <button className="close" aria-label="Close" onClick={closeCommit}>
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        {loading && <div className="empty">Loading…</div>}
        {!loading && error && <div className="panel-error">{error}</div>}
        {!loading && detail && (
          <>
            <div className="cd-subject">{detail.subject}</div>
            <div className="cd-meta">
              <button
                className="cd-hash"
                title="Copy full hash"
                onClick={() => void navigator.clipboard?.writeText(detail.hash)}
              >
                {detail.shortHash}
              </button>
              <span>{detail.author}</span>
              <span>{formatDate(detail.date)}</span>
              {SIG_LABEL[detail.verification] && (
                <span className={`cd-sig cd-sig-${detail.verification}`}>
                  {SIG_LABEL[detail.verification]}
                </span>
              )}
            </div>
            {detail.body && <pre className="cd-body">{detail.body}</pre>}

            <div className="cd-actions">
              {snapshotIndex >= 0 && (
                <button onClick={() => setSnapshotIndex(snapshotIndex)}>◎ Fly city here</button>
              )}
              {branch && (
                <button
                  onClick={() =>
                    askConfirm({
                      title: 'Cherry-pick this commit?',
                      body: `Apply ${detail.shortHash} "${detail.subject}" onto ${branch}.`,
                      confirmLabel: 'Cherry-pick',
                      danger: false,
                      onConfirm: () => void cherryPick(detail.hash)
                    })
                  }
                >
                  ⤷ Cherry-pick
                </button>
              )}
            </div>

            <div className="cd-files-head">
              {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed
            </div>
            <div className="cd-files">
              {detail.files.map((f) => (
                <button
                  key={f.path}
                  className="cd-file"
                  onClick={() => openFile(f.path)}
                  title={f.path}
                >
                  <span className="cd-file-path">{f.path}</span>
                  {f.binary ? (
                    <span className="cd-file-bin">bin</span>
                  ) : (
                    <span className="cd-file-stat">
                      <span className="diff-add">+{f.additions}</span>{' '}
                      <span className="diff-del">−{f.deletions}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
