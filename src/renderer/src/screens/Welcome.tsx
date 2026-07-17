import { useState } from 'react'
import { hasApi, useStore } from '../store'

/** Last path segment, for showing a repo's folder name. */
function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

export default function Welcome(): React.JSX.Element {
  // per-field selectors: a whole-store subscription would re-render Welcome on
  // every unrelated store change
  const openLocal = useStore((s) => s.openLocal)
  const openPath = useStore((s) => s.openPath)
  const openUrl = useStore((s) => s.openUrl)
  const error = useStore((s) => s.error)
  const gitVersion = useStore((s) => s.gitVersion)
  const recentRepos = useStore((s) => s.recentRepos)
  const clearRecent = useStore((s) => s.clearRecent)
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const gitMissing = gitVersion === null

  const submitUrl = (): void => {
    if (url.trim()) void openUrl(url)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (gitMissing || !hasApi()) return
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const path = window.gitCity.pathForFile(file)
    if (path) void openPath(path)
  }

  return (
    <div
      className={`welcome ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        // only clear when the pointer actually leaves the window
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <h1>Git City</h1>
      <p className="tagline">Watch your repository come alive as a city.</p>

      <div className="card">
        {gitMissing && (
          <div className="error">
            Git doesn&apos;t seem to be installed (or isn&apos;t on your PATH). Git City needs the
            git command line tool — get it from git-scm.com, then restart the app.
          </div>
        )}
        {error && <div className="error">{error}</div>}

        <button className="primary" onClick={() => void openLocal()} disabled={gitMissing}>
          Open a local repository…
        </button>

        {recentRepos.length > 0 && (
          <div className="recent">
            <div className="recent-head">
              <span>Recent</span>
              <button onClick={clearRecent}>Clear</button>
            </div>
            {recentRepos.map((p) => (
              <button
                key={p}
                className="recent-item"
                title={p}
                disabled={gitMissing}
                onClick={() => void openPath(p)}
              >
                <span className="recent-name">{baseName(p)}</span>
                <span className="recent-path">{p}</span>
              </button>
            ))}
          </div>
        )}

        <div className="divider">or paste a repository URL</div>

        <div className="url-row">
          <input
            type="text"
            placeholder="https://github.com/expressjs/express"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
            disabled={gitMissing}
          />
          <button onClick={submitUrl} disabled={gitMissing || !url.trim()}>
            Clone
          </button>
        </div>

        <p className="hint">
          Drag a repo folder anywhere onto this window to open it. Public repositories only for
          cloning. Folders become districts, files become buildings — height is lines of code.
        </p>
      </div>

      {dragging && <div className="drop-overlay">Drop a repository folder to open it</div>}
    </div>
  )
}
