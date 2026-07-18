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
  /** ground-floor shopfront band (tall buildings only) */
  shopEnabled: { value: number }
  shopColor: { value: Color }
  shopIntensity: { value: number }
}

/** world-height of the ground-floor shop band */
const SHOP_HEIGHT = 2.4
/** buildings shorter than this get no storefront (houses, sheds) */
const SHOP_MIN_BUILDING_HEIGHT = 6.0

export function createBuildingMaterial(): {
  material: MeshStandardMaterial
  win: WindowUniforms
} {
  const win: WindowUniforms = {
    enabled: { value: 0 },
    color: { value: new Color('#ffd27a') },
    intensity: { value: 0 },
    shopEnabled: { value: 0 },
    shopColor: { value: new Color('#ffd9a0') },
    shopIntensity: { value: 0 }
  }

  const material = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWinEnabled = win.enabled
    shader.uniforms.uWinColor = win.color
    shader.uniforms.uWinIntensity = win.intensity
    shader.uniforms.uShopEnabled = win.shopEnabled
    shader.uniforms.uShopColor = win.shopColor
    shader.uniforms.uShopIntensity = win.shopIntensity

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPosNW;
         varying vec3 vONormNW;
         varying float vBldHNW;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         #ifdef USE_INSTANCING
           vec4 wpNW = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
           vBldHNW = instanceMatrix[1][1];
         #else
           vec4 wpNW = modelMatrix * vec4( transformed, 1.0 );
           vBldHNW = 0.0;
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
         varying float vBldHNW;
         uniform float uWinEnabled;
         uniform vec3 uWinColor;
         uniform float uWinIntensity;
         uniform float uShopEnabled;
         uniform vec3 uShopColor;
         uniform float uShopIntensity;
         float hashNW( vec2 p ){ return fract( sin( dot( p, vec2(127.1,311.7) ) ) * 43758.5453 ); }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         if ( uWinEnabled > 0.5 || uShopEnabled > 0.5 ) {
           float up = abs( vONormNW.y );
           if ( up < 0.5 ) {
             float rowH = 3.0;
             float colW = 2.4;
             float horiz = abs( vONormNW.x ) > 0.5 ? vWPosNW.z : vWPosNW.x;
             // ground-floor shop band: only tall buildings, only when the theme asks
             float shopZone = uShopEnabled
               * step( vWPosNW.y, ${SHOP_HEIGHT.toFixed(1)} )
               * step( ${SHOP_MIN_BUILDING_HEIGHT.toFixed(1)}, vBldHNW );
             if ( uWinEnabled > 0.5 ) {
               float ry = fract( vWPosNW.y / rowH );
               float rx = fract( horiz / colW );
               float pane = step(0.18, ry) * step(ry, 0.72) * step(0.22, rx) * step(rx, 0.78);
               float lit = step( 0.42, hashNW( floor( vec2( horiz / colW, vWPosNW.y / rowH ) ) ) );
               // regular windows stop where the shopfront begins
               totalEmissiveRadiance += uWinColor * ( pane * lit * uWinIntensity ) * ( 1.0 - shopZone );
             }
             if ( shopZone > 0.5 ) {
               float shopW = colW * 2.2;
               float sx = fract( horiz / shopW );
               // wide, always-lit display windows below a signage stripe
               float pane = step( 0.06, sx ) * step( sx, 0.94 )
                 * step( 0.15, vWPosNW.y ) * step( vWPosNW.y, ${(SHOP_HEIGHT * 0.78).toFixed(2)} );
               float sign = step( ${(SHOP_HEIGHT * 0.85).toFixed(2)}, vWPosNW.y )
                 * step( vWPosNW.y, ${(SHOP_HEIGHT * 0.97).toFixed(2)} );
               // vary the sign tint per building so streets don't repeat
               vec3 tint = mix( uShopColor, uShopColor.gbr, step( 0.5, hashNW( floor( vWPosNW.xz / 8.0 ) ) ) );
               totalEmissiveRadiance += tint * ( pane * 0.6 + sign ) * uShopIntensity;
             }
           }
         }`
      )
  }

  return { material, win }
}
