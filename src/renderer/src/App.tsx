import { useEffect } from 'react'
import { useStore } from './store'
import Welcome from './screens/Welcome'
import Loading from './screens/Loading'
import EmptyRepoView from './screens/EmptyRepoView'
import SceneView from './city/SceneView'
import ConfirmDialog from './panels/ConfirmDialog'
import OpErrorToast from './panels/OpErrorToast'

export default function App(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  // a repo with no commits opens, but there is no history to render as a scene
  const hasScene = useStore((s) => (s.analysis?.snapshots.length ?? 0) > 0)
  const init = useStore((s) => s.init)

  useEffect(() => init(), [init])

  return (
    <>
      {screen === 'welcome' && <Welcome />}
      {screen === 'loading' && <Loading />}
      {screen === 'city' && (hasScene ? <SceneView /> : <EmptyRepoView />)}
      {/* root-level overlays available from any screen */}
      <ConfirmDialog />
      <OpErrorToast />
    </>
  )
}
