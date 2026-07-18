import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { useStore } from '../store'

const UP = new Vector3(0, 1, 0)
const offsetScratch = new Vector3() // reused every frame during the intro orbit

/**
 * Thin wrapper around three's own MapControls (pan/zoom/orbit above the scene).
 * Used instead of @react-three/drei's version so the app has no dependency on
 * troika-three-text — its embedded base64 WASM blob is a notorious antivirus
 * false-positive trigger once bundled.
 *
 * View-mode agnostic: the host scene supplies `resolveFocus` to map a selected
 * file path to a world position (building plot, ship, …) for the fly-to.
 *
 * Adds two cinematic touches, both hand-rolled (no tween lib):
 *  - a slow intro orbit when a scene first loads, cancelled on any interaction
 *  - a smooth fly-to that frames the selected object
 */
export default function CameraRig({
  worldSize,
  resolveFocus,
  maxPolarAngle = Math.PI * 0.47,
  focusDistance
}: {
  worldSize: number
  resolveFocus: (path: string) => Vector3 | null
  maxPolarAngle?: number
  focusDistance?: number
}): null {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const selected = useStore((s) => s.selected)

  const controls = useMemo(() => new MapControls(camera, gl.domElement), [camera, gl])

  const intro = useRef(true)
  const tween = useRef<{ target: Vector3; pos: Vector3 } | null>(null)

  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = maxPolarAngle
    controls.minDistance = 8
    controls.maxDistance = worldSize * 4
    controls.target.set(0, 0, 0)
    controls.update()
    const stopAuto = (): void => {
      intro.current = false
      tween.current = null
    }
    controls.addEventListener('start', stopAuto)
    return () => {
      controls.removeEventListener('start', stopAuto)
      controls.dispose()
    }
  }, [controls, worldSize, maxPolarAngle])

  // fly-to when the selection changes to something the scene can locate
  useEffect(() => {
    if (!selected) return
    const center = resolveFocus(selected)
    if (!center) return
    // keep the current view direction, just re-frame at a closer distance
    const dir = new Vector3().subVectors(camera.position, controls.target).normalize()
    const dist = focusDistance ?? Math.max(22, worldSize * 0.28)
    intro.current = false
    tween.current = { target: center, pos: new Vector3().copy(center).addScaledVector(dir, dist) }
  }, [selected, resolveFocus, worldSize, focusDistance, camera, controls])

  useFrame((_, dt) => {
    if (intro.current) {
      // orbit by rotating the camera around the target (MapControls has no azimuth setter)
      const offset = offsetScratch.subVectors(camera.position, controls.target)
      offset.applyAxisAngle(UP, Math.min(dt, 0.05) * 0.12)
      camera.position.copy(controls.target).add(offset)
    } else if (tween.current) {
      const k = 1 - Math.exp(-Math.min(dt, 0.05) * 4)
      controls.target.lerp(tween.current.target, k)
      camera.position.lerp(tween.current.pos, k)
      if (
        camera.position.distanceTo(tween.current.pos) < 0.5 &&
        controls.target.distanceTo(tween.current.target) < 0.5
      ) {
        tween.current = null
      }
    }
    controls.update()
  })

  return null
}
