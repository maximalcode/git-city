import { useEffect, useMemo, useRef } from 'react'
import type { Color } from 'three'
import { cameraHeading } from '../lib/cameraHeading'
import type { CityModel } from './cityData'
import type { ForestModel } from '../layout/forest'

const SIZE = 140 // logical px
const PAD = 8

interface Dot {
  x: number
  z: number
  style: string
}

/** Extract map dots (world XZ centre + colour) from either scene model. */
function dotsOf(model: CityModel | ForestModel, viewMode: 'city' | 'forest'): Dot[] {
  const colors = model.langColors as Color[]
  const out: Dot[] = []
  if (viewMode === 'city') {
    const plots = (model as CityModel).layout.plots
    for (let i = 0; i < plots.length; i++) {
      const r = plots[i].rect
      out.push({ x: r.x + r.w / 2, z: r.y + r.h / 2, style: colors[i].getStyle() })
    }
  } else {
    const pos = (model as ForestModel).positions
    for (let i = 0; i < colors.length; i++) {
      out.push({ x: pos[i * 3], z: pos[i * 3 + 2], style: colors[i].getStyle() })
    }
  }
  return out
}

/**
 * Top-down orientation minimap (north = −Z, up). Files show as coloured dots; a
 * triangular marker tracks the camera's look target and facing. Static base is
 * rendered once to an offscreen canvas per model; only the camera marker redraws
 * each frame, off React's render path via the shared cameraHeading ref.
 */
export default function Minimap({
  model,
  viewMode
}: {
  model: CityModel | ForestModel
  viewMode: 'city' | 'forest'
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const worldSize =
    viewMode === 'city' ? (model as CityModel).citySize : (model as ForestModel).worldSize

  const dots = useMemo(() => dotsOf(model, viewMode), [model, viewMode])

  // world XZ → canvas px (north up: +Z maps downward)
  const span = worldSize * 1.08
  const toX = (wx: number): number => PAD + (wx / span + 0.5) * (SIZE - 2 * PAD)
  const toY = (wz: number): number => PAD + (wz / span + 0.5) * (SIZE - 2 * PAD)

  // build the static base once per model
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const base = document.createElement('canvas')
    base.width = SIZE * dpr
    base.height = SIZE * dpr
    const ctx = base.getContext('2d')!
    ctx.scale(dpr, dpr)
    for (const d of dots) {
      ctx.fillStyle = d.style
      ctx.globalAlpha = 0.72
      ctx.fillRect(toX(d.x) - 1, toY(d.z) - 1, 2.4, 2.4)
    }
    ctx.globalAlpha = 1
    baseRef.current = base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, worldSize])

  // per-frame: blit base, draw camera marker
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d')!
    let raf = 0

    const draw = (): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, SIZE, SIZE)
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, SIZE, SIZE)

      // camera marker: a triangle at the look target, pointing along the view dir
      const mx = toX(cameraHeading.tx)
      const my = toY(cameraHeading.tz)
      const ang = Math.atan2(cameraHeading.dx, cameraHeading.dz) // 0 = looking +Z (down)
      ctx.save()
      ctx.translate(mx, my)
      ctx.rotate(-ang) // canvas +y is down = world +Z, so rotate by −ang
      ctx.beginPath()
      ctx.moveTo(0, 7) // apex points along view direction
      ctx.lineTo(-4.5, -4)
      ctx.lineTo(4.5, -4)
      ctx.closePath()
      ctx.fillStyle = '#ffb347'
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1
      ctx.fill()
      ctx.stroke()
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }
    // paint one frame immediately so the map shows even before the first rAF
    // (and in occluded/headless contexts where rAF is throttled)
    draw()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldSize])

  return (
    <div className="minimap" aria-hidden>
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
      <span className="minimap-n">N</span>
    </div>
  )
}
