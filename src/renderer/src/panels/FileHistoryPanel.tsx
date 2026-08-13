import type { BlameLine, FileCommit } from '../../../shared/types'
import { useRepoQuery } from '../lib/repoQuery'
import { useStore } from '../store'
import { formatDate } from '../lib/format'

type FileRead = { kind: 'history'; commits: FileCommit[] } | { kind: 'blame'; lines: BlameLine[] }

/**
 * Right-side panel showing either a file's commit history or its per-line
 * blame, depending on store.fileView. Triggered from the building details panel.
 */
export default function FileHistoryPanel(): React.JSX.Element | null {
  const fileView = useStore((s) => s.fileView)
  const selected = useStore((s) => s.selected)
  const repoPath = useStore((s) => s.repoPath)
  const setFileView = useStore((s) => s.setFileView)

  const { data, loading, error, reload } = useRepoQuery(
    fileView !== 'none' && selected && repoPath ? ([repoPath, selected, fileView] as const) : null,
    async (api, [repo, path, view]): Promise<FileRead> =>
      view === 'history'
        ? { kind: 'history', commits: await api.fileHistory(repo, path) }
        : { kind: 'blame', lines: await api.blame(repo, path) }
  )
  const commits = data?.kind === 'history' ? data.commits : null
  const blame = data?.kind === 'blame' ? data.lines : null

  if (fileView === 'none' || !selected) return null

  return (
    <div className="filehist-panel">
      <div className="panel-head">
        <div className="filehist-tabs">
          <button
            className={fileView === 'history' ? 'active' : ''}
            onClick={() => setFileView('history')}
          >
            History
          </button>
          <button
            className={fileView === 'blame' ? 'active' : ''}
            onClick={() => setFileView('blame')}
          >
            Blame
          </button>
        </div>
        <button className="close" aria-label="Close" onClick={() => setFileView('none')}>
          ✕
        </button>
      </div>
      <div className="filehist-path">{selected}</div>

      <div className="filehist-body">
        {loading && <div className="empty">Loading…</div>}
        {!loading && error && (
          <div className="panel-error">
            <span>{error}</span>
            <button onClick={reload}>Retry</button>
          </div>
        )}

        {!loading && fileView === 'history' && commits && (
          <div className="commit-list">
            {commits.length === 0 && <div className="empty">No history for this file.</div>}
            {commits.map((c) => (
              <div
                key={c.hash}
                className="commit-item"
                onClick={() => useStore.getState().setDiffOpen(true, c.hash)}
                title="View this commit's diff of the file"
              >
                <div className="commit-row1">
                  <span className="commit-hash">{c.shortHash}</span>
                  <span className="commit-subject">{c.subject}</span>
                </div>
                <div className="commit-row2">
                  {c.author} · {formatDate(c.date)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && fileView === 'blame' && blame && (
          <div className="blame-view">
            {blame.length === 0 && <div className="empty">No blame available.</div>}
            {blame.map((l) => (
              <div key={l.lineNo} className="blame-line">
                <span className="blame-gutter" title={`${l.author} · ${formatDate(l.date)}`}>
                  <span className="blame-hash">{l.commitShort}</span>
                  <span className="blame-author">{l.author}</span>
                </span>
                <span className="blame-lineno">{l.lineNo}</span>
                <span className="blame-text">{l.text || ' '}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
