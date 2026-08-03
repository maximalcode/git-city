import { useState } from 'react'
import type { GitVersion } from '../../../shared/types'
import { tooOldMessage } from '../../../shared/gitVersion'
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
  const pendingProbe = useStore((s) => s.pendingProbe)
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)

  // Three states, three different instructions: install git, update git, or
  // wait for the size probe. All of them disable the open controls, but only
  // the first two are the user's problem to fix (#25).
  const gitMissing = gitVersion === null
  const gitTooOld = gitVersion !== null && gitVersion !== 'checking' && !gitVersion.supported
  const probing = pendingProbe !== null
  const blocked = gitMissing || gitTooOld || probing

  const submitUrl = (): void => {
    if (url.trim()) void openUrl(url)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (blocked || !hasApi()) return
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
        {gitTooOld && <div className="error">{tooOldMessage(gitVersion as GitVersion)}</div>}
        {error && <div className="error">{error}</div>}

        <button className="primary" onClick={() => void openLocal()} disabled={blocked}>
          {probing ? 'Checking repository size…' : 'Open a local repository…'}
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
                disabled={blocked}
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
            disabled={blocked}
          />
          <button onClick={submitUrl} disabled={blocked || !url.trim()}>
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
