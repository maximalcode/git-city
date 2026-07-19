import { useStore } from '../store'
import SideRail from '../city/SideRail'
import ChangesPanel from '../panels/ChangesPanel'
import BranchesPanel from '../panels/BranchesPanel'
import StashPanel from '../panels/StashPanel'
import DiffPanel from '../panels/DiffPanel'

/**
 * Shown when a repository has no commits yet (a fresh `git init`). There is no
 * history to render as a city, but the full working-tree flow still works — so
 * we surface the tool rail and the Changes panel and invite the user to stage
 * files and make the first commit. The moment they do, `refreshAnalysis` sees a
 * commit and `App` swaps to the live scene. (`loadRepo` already opens the
 * Changes panel for a commit-less repo, so no mount effect is needed here.)
 */
export default function EmptyRepoView(): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)
  const setPanel = useStore((s) => s.setPanel)
  const changeCount = useStore((s) => s.workingStatus?.files.length ?? 0)

  const name = analysis?.info.name ?? 'repository'
  const branch = analysis?.info.branch ?? 'main'

  return (
    <div className="city-root empty-repo">
      <SideRail />

      <div className="empty-repo-hero">
        <div className="empty-repo-card">
          <div className="empty-repo-badge">{name}</div>
          <h2>No commits yet</h2>
          <p>
            This repository is on <span className="mono">{branch}</span> with no history to grow a
            city from — yet.{' '}
            {changeCount > 0 ? (
              <>
                You have <strong>{changeCount}</strong> change{changeCount === 1 ? '' : 's'} ready.
              </>
            ) : (
              <>Add some files to the folder to get started.</>
            )}
          </p>
          <p className="empty-repo-steps">
            Open <strong>Changes</strong> (C) → stage your files → write a message → commit. Your
            first buildings rise the moment you do.
          </p>
          <button className="primary" onClick={() => setPanel('changes')}>
            Open Changes
          </button>
        </div>
      </div>

      <ChangesPanel />
      <BranchesPanel />
      <StashPanel />
      <DiffPanel />
    </div>
  )
}
