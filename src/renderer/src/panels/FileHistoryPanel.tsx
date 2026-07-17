import { useEffect, useState } from 'react'
import type { BlameLine, FileCommit } from '../../../shared/types'
import { useStore } from '../store'

/**
 * Right-side panel showing either a file's commit history or its per-line
 * blame, depending on store.fileView. Triggered from the building details panel.
 */
export default function FileHistoryPanel(): React.JSX.Element | null {
  const fileView = useStore((s) => s.fileView)
  const selected = useStore((s) => s.selected)
  const repoPath = useStore((s) => s.repoPath)
  const setFileView = useStore((s) => s.setFileView)

  const [commits, setCommits] = useState<FileCommit[] | null>(null)
  const [blame, setBlame] = useState<BlameLine[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (fileView === 'none' || !selected || !repoPath || !('gitCity' in window)) return
    let cancelled = false
    setLoading(true)
    setCommits(null)
    setBlame(null)
    const job =
      fileView === 'history'
        ? window.gitCity.fileHistory(repoPath, selected).then((c) => !cancelled && setCommits(c))
        : window.gitCity.blame(repoPath, selected).then((b) => !cancelled && setBlame(b))
    void job.catch(() => {}).finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [fileView, selected, repoPath])

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
        <button className="close" onClick={() => setFileView('none')}>
          ✕
        </button>
      </div>
      <div className="filehist-path">{selected}</div>

      <div className="filehist-body">
        {loading && <div className="empty">Loading…</div>}

        {!loading && fileView === 'history' && commits && (
          <div className="commit-list">
            {commits.length === 0 && <div className="empty">No history for this file.</div>}
            {commits.map((c) => (
              <div
                key={c.hash}
                className="commit-item"
                onClick={() => useStore.getState().setDiffOpen(true)}
                title="View this file's diff"
              >
                <div className="commit-row1">
                  <span className="commit-hash">{c.shortHash}</span>
                  <span className="commit-subject">{c.subject}</span>
                </div>
                <div className="commit-row2">
                  {c.author} · {new Date(c.date).toLocaleDateString()}
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
                <span className="blame-gutter" title={`${l.author} · ${new Date(l.date).toLocaleDateString()}`}>
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
