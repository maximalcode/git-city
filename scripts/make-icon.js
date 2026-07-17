// Generates build/icon.png (512x512) procedurally — a tiny skyline on a
// rounded dark tile. Run: node scripts/make-icon.js
const { PNG } = require('pngjs')
const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')

const S = 512
const png = new PNG({ width: S, height: S })

const bg = [16, 20, 30]
const ground = [28, 35, 51]
const buildings = [
  // [x0, x1, yTop, r, g, b]
  [88, 190, 235, 110, 200, 255], // blue
  [210, 316, 130, 255, 179, 71], // tall orange
  [336, 424, 290, 241, 224, 90] // yellow
]
const GROUND_Y = 432
const RADIUS = 96

function insideRoundedRect(x, y) {
  const r = RADIUS
  const cx = x < r ? r : x > S - r ? S - r : x
  const cy = y < r ? r : y > S - r ? S - r : y
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const idx = (S * y + x) << 2
    if (!insideRoundedRect(x, y)) {
      png.data[idx + 3] = 0
      continue
    }
    // background with a soft warm glow low-center
    const glow = Math.max(0, 1 - Math.hypot(x - S / 2, y - 400) / 420)
    let c = [bg[0] + glow * 26, bg[1] + glow * 18, bg[2] + glow * 8]
    if (y >= GROUND_Y) c = ground
    for (const [x0, x1, yTop, r, g, b] of buildings) {
      if (x >= x0 && x < x1 && y >= yTop && y < GROUND_Y) {
        c = [r, g, b]
        // windows: dark dots on a grid
        const wx = (x - x0) % 26
        const wy = (y - yTop) % 30
        if (wx >= 8 && wx < 16 && wy >= 10 && wy < 20) {
          c = [c[0] * 0.28, c[1] * 0.28, c[2] * 0.32]
        }
      }
    }
    png.data[idx] = Math.min(255, Math.round(c[0]))
    png.data[idx + 1] = Math.min(255, Math.round(c[1]))
    png.data[idx + 2] = Math.min(255, Math.round(c[2]))
    png.data[idx + 3] = 255
  }
}

mkdirSync(join(__dirname, '..', 'build'), { recursive: true })
writeFileSync(join(__dirname, '..', 'build', 'icon.png'), PNG.sync.write(png))
console.log('wrote build/icon.png')
