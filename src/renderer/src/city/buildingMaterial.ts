import { Color, MeshStandardMaterial } from 'three'

/**
 * A MeshStandardMaterial patched (via onBeforeCompile) to draw procedural
 * emissive "windows" on the vertical faces of every building — computed in
 * WORLD space so windows stay a consistent size no matter how the per-instance
 * matrix scales each box. Driven by three uniforms the caller updates per theme.
 *
 * Keeps instancing intact (three still injects its instancing chunks); we only
 * add a world-position varying and an additive emissive term.
 */
export interface WindowUniforms {
  enabled: { value: number }
  color: { value: Color }
  intensity: { value: number }
}

export function createBuildingMaterial(): {
  material: MeshStandardMaterial
  win: WindowUniforms
} {
  const win: WindowUniforms = {
    enabled: { value: 0 },
    color: { value: new Color('#ffd27a') },
    intensity: { value: 0 }
  }

  const material = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWinEnabled = win.enabled
    shader.uniforms.uWinColor = win.color
    shader.uniforms.uWinIntensity = win.intensity

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPosNW;
         varying vec3 vONormNW;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         #ifdef USE_INSTANCING
           vec4 wpNW = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
         #else
           vec4 wpNW = modelMatrix * vec4( transformed, 1.0 );
         #endif
         vWPosNW = wpNW.xyz;
         vONormNW = normal;`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPosNW;
         varying vec3 vONormNW;
         uniform float uWinEnabled;
         uniform vec3 uWinColor;
         uniform float uWinIntensity;
         float hashNW( vec2 p ){ return fract( sin( dot( p, vec2(127.1,311.7) ) ) * 43758.5453 ); }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         if ( uWinEnabled > 0.5 ) {
           float up = abs( vONormNW.y );
           if ( up < 0.5 ) {
             float rowH = 3.0;
             float colW = 2.4;
             float horiz = abs( vONormNW.x ) > 0.5 ? vWPosNW.z : vWPosNW.x;
             float ry = fract( vWPosNW.y / rowH );
             float rx = fract( horiz / colW );
             float pane = step(0.18, ry) * step(ry, 0.72) * step(0.22, rx) * step(rx, 0.78);
             float lit = step( 0.42, hashNW( floor( vec2( horiz / colW, vWPosNW.y / rowH ) ) ) );
             totalEmissiveRadiance += uWinColor * ( pane * lit * uWinIntensity );
           }
         }`
      )
  }

  return { material, win }
}
