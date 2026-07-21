import { DoubleSide, MeshStandardMaterial } from 'three'
import { leafTexture } from './leafTexture'

/**
 * Material for the cross-plane canopies: alpha-tested leaf cutouts plus a
 * vertex-shader wind sway. The sway displaces each vertex horizontally by an
 * amount proportional to its height inside the canopy (trunk base stays put,
 * outer leaves move most) and is phase-shifted per instance so a row of street
 * trees never sways in lockstep.
 *
 * `uTime` must be advanced by the caller each frame.
 */
export interface FoliageUniforms {
  time: { value: number }
  strength: { value: number }
}

export function createFoliageMaterial(): {
  material: MeshStandardMaterial
  wind: FoliageUniforms
} {
  const wind: FoliageUniforms = { time: { value: 0 }, strength: { value: 0.09 } }

  const material = new MeshStandardMaterial({
    map: leafTexture(),
    // alpha TEST, not blending: no sort order to get wrong, and shadows work
    alphaTest: 0.45,
    transparent: false,
    side: DoubleSide,
    roughness: 0.85,
    metalness: 0,
    vertexColors: true
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind.time
    shader.uniforms.uWindStrength = wind.strength
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uWindTime;
         uniform float uWindStrength;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           #ifdef USE_INSTANCING
             // per-instance phase from the instance translation
             float phaseNW = dot( instanceMatrix[3].xz, vec2( 0.7, 1.3 ) );
           #else
             float phaseNW = 0.0;
           #endif
           // leaves higher in the canopy swing further; below y=0 nothing moves
           float liftNW = max( transformed.y, 0.0 );
           float swayNW = sin( uWindTime * 1.6 + phaseNW ) * uWindStrength * liftNW;
           transformed.x += swayNW;
           transformed.z += sin( uWindTime * 1.1 + phaseNW * 1.7 ) * uWindStrength * 0.6 * liftNW;
         }`
      )
  }

  return { material, wind }
}
