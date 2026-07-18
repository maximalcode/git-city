import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  SphereGeometry,
  type BufferGeometry,
  type Texture
} from 'three'
import { getTheme } from './themes'
import { useStore } from '../store'

/**
 * Deep-space backdrop for the fleet: a couple of slow-rotating planets and a
 * few soft nebula clouds, all wrapped in a group that drifts slowly for
 * parallax — so the void reads as a place you're travelling through rather
 * than empty black. Cheap: planets are lit low-poly spheres, nebulae are
 * additive gradient sprites. All GPU resources are disposed on unmount.
 */

/** deterministic PRNG so the same sky renders every load */
function makeRand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nebulaTexture(color: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128)
  const col = new Color(color)
  const rgb = `${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)}`
  g.addColorStop(0, `rgba(${rgb}, 0.9)`)
  g.addColorStop(0.4, `rgba(${rgb}, 0.35)`)
  g.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return new CanvasTexture(c)
}

interface PlanetSpec {
  pos: [number, number, number]
  radius: number
  color: string
  spin: number
}
interface NebulaSpec {
  pos: [number, number, number]
  size: number
  color: string
}

export default function FleetBackdrop({ worldSize }: { worldSize: number }): React.JSX.Element {
  const theme = getTheme(useStore((s) => s.themeId))
  const groupRef = useRef<Group>(null!)
  const planetRefs = useRef<(Mesh | null)[]>([])

  const { planets, nebulae } = useMemo(() => {
    const rand = makeRand(90210)
    const accent = theme.dirFill.color
    const accent2 = theme.dirMain.color
    const planets: PlanetSpec[] = [
      {
        pos: [-worldSize * 2.6, worldSize * 0.9, -worldSize * 3.2],
        radius: worldSize * 0.7,
        color: accent,
        spin: 0.02
      },
      {
        pos: [worldSize * 3.1, -worldSize * 0.4, -worldSize * 2.4],
        radius: worldSize * 0.45,
        color: theme.skyBottom,
        spin: -0.015
      }
    ]
    const palette = [accent, accent2, theme.skyTop, theme.skyBottom]
    const nebulae: NebulaSpec[] = Array.from({ length: 5 }, (_, i) => {
      const a = rand() * Math.PI * 2
      const r = worldSize * (3 + rand() * 3)
      return {
        pos: [Math.cos(a) * r, (rand() - 0.4) * worldSize * 2, Math.sin(a) * r - worldSize],
        size: worldSize * (3 + rand() * 4),
        color: palette[i % palette.length]
      }
    })
    return { planets, nebulae }
  }, [theme, worldSize])

  const nebulaTextures = useMemo(() => nebulae.map((n) => nebulaTexture(n.color)), [nebulae])
  useEffect(() => {
    const texs: Texture[] = nebulaTextures
    return () => {
      for (const t of texs) t.dispose()
    }
  }, [nebulaTextures])

  // planet geometries (disposed on unmount)
  const planetGeos = useMemo(
    () => planets.map((p) => new SphereGeometry(p.radius, 24, 16)),
    [planets]
  )
  useEffect(() => {
    const geos: BufferGeometry[] = planetGeos
    return () => {
      for (const g of geos) g.dispose()
    }
  }, [planetGeos])

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05)
    if (groupRef.current) groupRef.current.rotation.y += step * 0.008 // slow parallax drift
    for (let i = 0; i < planetRefs.current.length; i++) {
      const m = planetRefs.current[i]
      if (m) m.rotation.y += step * planets[i].spin
    }
  })

  return (
    <group ref={groupRef}>
      {planets.map((p, i) => (
        <mesh
          key={`planet${i}`}
          geometry={planetGeos[i]}
          position={p.pos}
          ref={(el) => (planetRefs.current[i] = el)}
        >
          <meshStandardMaterial
            color={p.color}
            roughness={1}
            metalness={0}
            emissive={new Color(p.color)}
            emissiveIntensity={0.08}
          />
        </mesh>
      ))}
      {nebulae.map((n, i) => (
        <mesh key={`neb${i}`} position={n.pos}>
          <planeGeometry args={[n.size, n.size]} />
          <meshBasicMaterial
            map={nebulaTextures[i]}
            transparent
            opacity={0.5}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}
