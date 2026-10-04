import { useEffect } from 'react'
import { useStore } from './store'
import Welcome from './screens/Welcome'
import Loading from './screens/Loading'
import EmptyRepoView from './screens/EmptyRepoView'
import SceneView from './city/SceneView'
import ConfirmDialog from './panels/ConfirmDialog'
import LargeRepoDialog from './panels/LargeRepoDialog'
import OpErrorToast from './panels/OpErrorToast'
import UpdateBanner from './panels/UpdateBanner'
import RehearsalPanel from './panels/RehearsalPanel'

export default function App(): React.JSX.Element {
  const rehearsalOpen = useStore((s) => s.rehearsalOpen && s.rehearsalConfigured && !!s.repoPath)
  const screen = useStore((s) => s.screen)
  // a repo with no commits opens, but there is no history to render as a scene
  const hasScene = useStore((s) => (s.analysis?.snapshots.length ?? 0) > 0)
  const init = useStore((s) => s.init)

  useEffect(() => init(), [init])

  return (
    <>
      <div className={`app-workspace${rehearsalOpen ? ' with-rehearsal' : ''}`}>
        {screen === 'welcome' && <Welcome />}
        {screen === 'loading' && <Loading />}
        {screen === 'city' && (hasScene ? <SceneView /> : <EmptyRepoView />)}
      </div>
      {/* root-level overlays available from any screen */}
      <ConfirmDialog />
      <LargeRepoDialog />
      <OpErrorToast />
      <UpdateBanner />
      <RehearsalPanel />
    </>
  )
}
