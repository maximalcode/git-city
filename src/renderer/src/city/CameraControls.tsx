import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'

/**
 * Thin wrapper around three's own MapControls (pan/zoom/orbit above the city).
 * Used instead of @react-three/drei's version so the app has no dependency on
 * troika-three-text — its embedded base64 WASM blob is a notorious antivirus
 * false-positive trigger once bundled.
 */
export default function CameraControls({ maxDistance }: { maxDistance: number }): null {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  const controls = useMemo(() => new MapControls(camera, gl.domElement), [camera, gl])

  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 8
    controls.maxDistance = maxDistance
    controls.target.set(0, 0, 0)
    controls.update()
    return () => controls.dispose()
  }, [controls, maxDistance])

  useFrame(() => controls.update())

  return null
}
