import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three'
import asphaltColorUrl from '../assets/textures/asphalt_color.jpg'
import asphaltNormalUrl from '../assets/textures/asphalt_normal.jpg'
import asphaltRoughUrl from '../assets/textures/asphalt_rough.jpg'
import pavingColorUrl from '../assets/textures/paving_color.jpg'
import pavingNormalUrl from '../assets/textures/paving_normal.jpg'
import concreteColorUrl from '../assets/textures/concrete_color.jpg'
import concreteNormalUrl from '../assets/textures/concrete_normal.jpg'

/**
 * Bundled CC0 PBR textures (see ../assets/textures/ATTRIBUTION.md). Loaded once
 * and shared for the lifetime of the app — consumers must never dispose them
 * (same contract as the cached traffic/tree geometries).
 *
 * Color maps are sRGB; normal/roughness maps stay linear per three conventions.
 */
export interface PbrSet {
  map: Texture
  normalMap: Texture | null
  roughnessMap: Texture | null
}

const loader = new TextureLoader()
const cache = new Map<string, Texture>()

function load(url: string, srgb: boolean): Texture {
  const hit = cache.get(url)
  if (hit) return hit
  const tex = loader.load(url)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.anisotropy = 8
  cache.set(url, tex)
  return tex
}

export function asphaltTextures(): PbrSet {
  return {
    map: load(asphaltColorUrl, true),
    normalMap: load(asphaltNormalUrl, false),
    roughnessMap: load(asphaltRoughUrl, false)
  }
}

export function pavingTextures(): PbrSet {
  return {
    map: load(pavingColorUrl, true),
    normalMap: load(pavingNormalUrl, false),
    roughnessMap: null
  }
}

export function concreteTextures(): PbrSet {
  return {
    map: load(concreteColorUrl, true),
    normalMap: load(concreteNormalUrl, false),
    roughnessMap: null
  }
}
