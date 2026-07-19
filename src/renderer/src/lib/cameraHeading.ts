/**
 * Shared, mutable camera-heading value. The CameraRig writes the current view
 * target and look direction here every frame; the DOM minimap/compass reads it
 * from its own rAF loop. Passing it through a module ref (instead of the store)
 * keeps a per-frame value off React's render path — the overlay animates without
 * re-rendering the whole HUD 60× a second.
 *
 * All coordinates are world XZ (the ground plane); north is −Z.
 */
export const cameraHeading = {
  /** camera look-at target, world X */
  tx: 0,
  /** camera look-at target, world Z */
  tz: 0,
  /** horizontal look direction X (target − camera), not normalized */
  dx: 0,
  /** horizontal look direction Z (target − camera), not normalized */
  dz: 1
}
