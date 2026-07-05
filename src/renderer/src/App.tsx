import { useEffect } from 'react'
import { useStore } from './store'
import Welcome from './screens/Welcome'
import Loading from './screens/Loading'
import CityView from './city/CityView'

export default function App(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const init = useStore((s) => s.init)

  useEffect(() => init(), [init])

  if (screen === 'welcome') return <Welcome />
  if (screen === 'loading') return <Loading />
  return <CityView />
}
