import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import type { Theme } from './themes'

/** Shared output/color processing for the live scene and frozen comparisons. */
export default function SceneEffects({
  theme,
  useAO,
  size
}: {
  theme: Theme
  useAO: boolean
  size: number
}): React.JSX.Element {
  return (
    <EffectComposer key={`fx-${useAO ? 'ao' : 'noao'}`} enableNormalPass={useAO}>
      {useAO ? <N8AO aoRadius={size * 0.06} intensity={2.4} distanceFalloff={1} halfRes /> : <></>}
      <Bloom
        luminanceThreshold={theme.bloom.threshold}
        intensity={theme.bloom.intensity}
        mipmapBlur
      />
      <Vignette darkness={theme.vignette} />
    </EffectComposer>
  )
}
