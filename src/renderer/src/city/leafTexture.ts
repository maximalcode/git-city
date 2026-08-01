import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter } from 'three'

/**
 * Procedural leaf-cluster texture for the cross-plane canopies: a soft blob of
 * overlapping alpha-tested leaf shapes on a transparent background. Drawn with
 * a deterministic scatter (no Math.random) so the city is identical every
 * build, and cached because every tree layer shares one texture.
 *
 * The RGB channel is pure white — foliage color comes from the per-instance
 * color (fixed green for the city's street trees).
 */

const SIZE = 128
let cached: CanvasTexture | null = null

function hash(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

export function leafTexture(): CanvasTexture {
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, SIZE, SIZE)

  const cx = SIZE / 2
  const cy = SIZE / 2
  // ~90 leaf ellipses, denser toward the middle so edges break up naturally
  for (let i = 0; i < 90; i++) {
    const a = hash(i * 3 + 1) * Math.PI * 2
    const rad = Math.sqrt(hash(i * 5 + 2)) * SIZE * 0.44
    const x = cx + Math.cos(a) * rad
    const y = cy + Math.sin(a) * rad * 0.86
    const rx = 7 + hash(i * 7 + 3) * 9
    const ry = rx * (0.5 + hash(i * 11 + 4) * 0.4)
    // brightness varies per leaf so the canopy has internal shading
    const shade = 0.62 + hash(i * 13 + 5) * 0.38
    const alpha = 0.75 + hash(i * 17 + 6) * 0.25
    const v = Math.round(255 * shade)
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, hash(i * 19 + 7) * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new CanvasTexture(canvas)
  // alpha-tested cutouts: mipmaps for the distance, nearest magnification so
  // near leaves stay crisp instead of turning into mush
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = NearestFilter
  tex.anisotropy = 4
  cached = tex
  return tex
}
