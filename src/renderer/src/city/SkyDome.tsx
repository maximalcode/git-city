import { useEffect, useMemo } from 'react'
import { BackSide, Color, ShaderMaterial } from 'three'

/**
 * A large inverted sphere with a vertical gradient — a cheap, asset-free sky.
 * Renders behind everything (BackSide, no depth write, fog off). Colors come
 * from the active theme.
 */
export default function SkyDome({
  top,
  bottom,
  radius
}: {
  top: string
  bottom: string
  radius: number
}): React.JSX.Element {
  // One material for the component's lifetime — theme changes only update the
  // color uniforms, so nothing is reallocated (or leaked) on theme switch.
  const material = useMemo(() => {
    return new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new Color() },
        uBottom: { value: new Color() }
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform vec3 uTop;
        uniform vec3 uBottom;
        void main() {
          float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
          // ease the horizon a touch
          h = pow(h, 0.7);
          gl_FragColor = vec4(mix(uBottom, uTop, h), 1.0);
        }
      `
    })
  }, [])

  useEffect(() => {
    ;(material.uniforms.uTop.value as Color).set(top)
    ;(material.uniforms.uBottom.value as Color).set(bottom)
  }, [material, top, bottom])

  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh scale={[radius, radius, radius]} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 16]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}
