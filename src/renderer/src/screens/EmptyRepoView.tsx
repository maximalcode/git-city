import { useStore } from '../store'
import { getMode } from '../city/modes'
import { useHotkeys } from '../lib/useHotkeys'
import { REPO_HOTKEYS } from '../lib/repoHotkeys'
import Icon from '../lib/icons'
import SideRail from '../city/SideRail'
import Onboarding from '../city/Onboarding'
import ChangesPanel from '../panels/ChangesPanel'
import BranchesPanel from '../panels/BranchesPanel'
import StashPanel from '../panels/StashPanel'
import DiffPanel from '../panels/DiffPanel'
import SettingsPanel from '../panels/SettingsPanel'

/**
 * Shown when a repository has no commits yet (a fresh `git init`). There is no
 * history to render as a city, but the full working-tree flow still works — so
 * we surface the tool rail and the Changes panel and invite the user to stage
 * files and make the first commit. The moment they do, `refreshAnalysis` sees a
 * commit and `App` swaps to the live scene. (`loadRepo` already opens the
 * Changes panel for a commit-less repo, so no mount effect is needed here.)
 *
 * It is also a screen a user can land on by mistake — the pitch invites you to
 * point the app at a fresh `git init` — so it carries its own way back out.
 */
export default function EmptyRepoView(): React.JSX.Element {
  const analysis = useStore((s) => s.analysis)
  const setPanel = useStore((s) => s.setPanel)
  const backToWelcome = useStore((s) => s.backToWelcome)
  const changeCount = useStore((s) => s.workingStatus?.files.length ?? 0)
  const helpOpen = useStore((s) => s.helpOpen)
  const modalOpen = useStore((s) => s.confirm !== null)

  const name = analysis?.info.name ?? 'repository'
  const branch = analysis?.info.branch ?? 'main'
  // the mode is already chosen here, so promise the world they will actually get
  const noun = getMode(useStore((s) => s.viewMode)).noun

  // the panels this screen mounts are exactly the ones REPO_HOTKEYS drives;
  // suspended under a confirm dialog, as in the HUD
  useHotkeys(REPO_HOTKEYS, !modalOpen)

  return (
    <div className="city-root empty-repo">
      <SideRail hasHistory={false} />

      <div className="empty-repo-hero">
        <div className="empty-repo-card">
          <div className="empty-repo-badge">{name}</div>
          <h2>No commits yet</h2>
          <p>
            This repository is on <span className="mono">{branch}</span> with no history to grow a{' '}
            {noun} from — yet.{' '}
            {changeCount > 0 ? (
              <>
                You have <strong>{changeCount}</strong> change{changeCount === 1 ? '' : 's'} ready.
              </>
            ) : (
              <>Add some files to the folder to get started.</>
            )}
          </p>
          <p className="empty-repo-steps">
            Open <strong>Changes</strong> (C) → stage your files → write a message → commit. The
            first {noun === 'farm' ? 'fields are sown' : 'buildings rise'} the moment you do.
          </p>
          <div className="empty-repo-actions">
            <button className="primary" onClick={() => setPanel('changes')}>
              Open Changes
            </button>
            <button onClick={backToWelcome} title="Open another repository">
              <Icon name="open" size={15} />
              Open another repository
            </button>
          </div>
        </div>
      </div>

      {/* Only when asked for. Onboarding shows itself unprompted on first run,
          and a guide to reading building heights is no use in front of a
          repository that has none — it would also mark itself seen before the
          user ever reaches a scene. */}
      {helpOpen && <Onboarding />}
      <ChangesPanel />
      <BranchesPanel />
      <StashPanel />
      <DiffPanel />
      <SettingsPanel />
    </div>
  )
}
