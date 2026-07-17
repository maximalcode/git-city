import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { useStore } from '../store'
import type { CityModel } from './cityData'

const UP = new Vector3(0, 1, 0)
const offsetScratch = new Vector3() // reused every frame during the intro orbit

/**
 * Thin wrapper around three's own MapControls (pan/zoom/orbit above the city).
 * Used instead of @react-three/drei's version so the app has no dependency on
 * troika-three-text — its embedded base64 WASM blob is a notorious antivirus
 * false-positive trigger once bundled.
 *
 * Adds two cinematic touches, both hand-rolled (no tween lib):
 *  - a slow intro orbit when a city first loads, cancelled on any interaction
 *  - a smooth fly-to that frames a building when it becomes selected
 */
export default function CameraControls({
  maxDistance,
  model
}: {
  maxDistance: number
  model: CityModel
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
    controls.maxPolarAngle = Math.PI * 0.47
    controls.minDistance = 8
    controls.maxDistance = maxDistance
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
  }, [controls, maxDistance])

  // fly-to when the selection changes to a building that has a plot
  useEffect(() => {
    if (!selected) return
    const i = model.indexOf.get(selected)
    if (i === undefined) return
    const { rect } = model.layout.plots[i]
    const center = new Vector3(rect.x + rect.w / 2, 5, rect.y + rect.h / 2)
    // keep the current view direction, just re-frame at a closer distance
    const dir = new Vector3().subVectors(camera.position, controls.target).normalize()
    const dist = Math.max(22, model.citySize * 0.28)
    intro.current = false
    tween.current = { target: center, pos: new Vector3().copy(center).addScaledVector(dir, dist) }
  }, [selected, model, camera, controls])

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
