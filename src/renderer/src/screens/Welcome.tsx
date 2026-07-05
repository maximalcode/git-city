import { useState } from 'react'
import { useStore } from '../store'

export default function Welcome(): React.JSX.Element {
  const { openLocal, openUrl, error, gitVersion } = useStore()
  const [url, setUrl] = useState('')
  const gitMissing = gitVersion === null

  const submitUrl = (): void => {
    if (url.trim()) void openUrl(url)
  }

  return (
    <div className="welcome">
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
          Public repositories only. Folders become districts, files become buildings — height is
          lines of code. Drag the timeline to travel through the project&apos;s history.
        </p>
      </div>
    </div>
  )
}
