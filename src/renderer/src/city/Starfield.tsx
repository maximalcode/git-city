import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'

/**
 * A deterministic shell of distant stars around the fleet. One Points draw
 * call; geometry rebuilt (and the old one disposed) only when worldSize
 * changes.
 */
export default function Starfield({ worldSize }: { worldSize: number }): React.JSX.Element {
  const geometry = useMemo(() => {
    const count = 1500
    const positions = new Float32Array(count * 3)
    // deterministic PRNG (mulberry32-ish) — same sky every load
    let s = 12345
    const rand = (): number => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const rMin = worldSize * 4
    const rMax = worldSize * 8
    for (let i = 0; i < count; i++) {
      // uniform direction via normalized gaussian-ish triple
      const u = rand() * 2 - 1
      const phi = rand() * Math.PI * 2
      const sq = Math.sqrt(1 - u * u)
      const r = rMin + rand() * (rMax - rMin)
      positions[i * 3] = sq * Math.cos(phi) * r
      positions[i * 3 + 1] = Math.abs(u) * r * 0.6 + worldSize * 0.2 // bias above the horizon
      positions[i * 3 + 2] = sq * Math.sin(phi) * r
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    return geo
  }, [worldSize])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        color="#cdd8ff"
        size={worldSize * 0.012}
        sizeAttenuation
        toneMapped={false}
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </points>
  )
}
