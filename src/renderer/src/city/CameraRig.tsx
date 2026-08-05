import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { useStore } from '../store'
import { cameraHeading } from '../lib/cameraHeading'

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
  const scene = useThree((s) => s.scene)
  const selected = useStore((s) => s.selected)
  const reduceMotion = useStore((s) => s.reduceMotion)

  const controls = useMemo(() => new MapControls(camera, gl.domElement), [camera, gl])

  // "Reduce motion" skips the cinematic intro orbit entirely
  const intro = useRef(!reduceMotion)
  const tween = useRef<{ target: Vector3; pos: Vector3 } | null>(null)

  // Create once. dispose() detaches the DOM listeners, so it must run ONLY on
  // unmount — never when worldSize changes (a view-mode switch changes it,
  // since the modes size their worlds differently). If it ran on every switch the
  // memoized controls would be disposed and never reconnected, leaving the
  // camera dead. Size/angle limits live in the separate effect below.
  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 8
    controls.target.set(0, 0, 0)
    const stopAuto = (): void => {
      intro.current = false
      tween.current = null
    }
    controls.addEventListener('start', stopAuto)
    return () => {
      controls.removeEventListener('start', stopAuto)
      controls.dispose()
      // DEV probe: a view-mode switch must NOT reach here (see e2e). If this
      // increments on a switch, the controls were torn down and the camera dies.
      if (import.meta.env.DEV) {
        const w = window as unknown as { __gitCityRigDisposes?: number }
        w.__gitCityRigDisposes = (w.__gitCityRigDisposes ?? 0) + 1
      }
    }
  }, [controls])

  // Someone reacting to the motion they can see, by ticking "Reduce motion",
  // was watching the camera keep orbiting: the flag was only read when the rig
  // was created, and the orbit has no time limit, so it did not stop on its
  // own either. The setting looked broken until the next repo open (#30).
  useEffect(() => {
    if (reduceMotion) intro.current = false
  }, [reduceMotion])

  // Update limits that depend on the active world size / mode without tearing
  // the controls down.
  useEffect(() => {
    controls.maxPolarAngle = maxPolarAngle
    controls.maxDistance = worldSize * 4
    controls.update()
  }, [controls, worldSize, maxPolarAngle])

  // DEV only: expose the camera so the preview/e2e can assert it still responds
  // to input after a view-mode switch (the regression this rig guards against).
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as {
        __gitCityCam?: unknown
        __gitCityScene?: unknown
        __gitCitySceneReadyMs?: number
      }
      w.__gitCityCam = camera
      // The scene root too: it is what lets a headless probe ask "which
      // instanced meshes actually moved this second?" — the only sound way to
      // verify animation from outside the canvas (#58).
      w.__gitCityScene = scene
      // Milliseconds from navigation start to the scene being interactive.
      // The scale work in #12 needed this and had to infer it from a polling
      // probe, which is not sound — the rig does not remount when the model
      // changes, so the sentinel never resets. One timestamp makes the cost
      // directly readable instead.
      w.__gitCitySceneReadyMs = performance.now()
    }
  }, [camera, scene])

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

    // publish the view target + horizontal look direction for the minimap/compass
    cameraHeading.tx = controls.target.x
    cameraHeading.tz = controls.target.z
    cameraHeading.dx = controls.target.x - camera.position.x
    cameraHeading.dz = controls.target.z - camera.position.z
  })

  return null
}
