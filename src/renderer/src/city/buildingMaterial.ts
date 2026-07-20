import { Color, MeshStandardMaterial } from 'three'
import { concreteTextures } from './pbrTextures'

/**
 * A MeshStandardMaterial patched (via onBeforeCompile) into a real facade
 * shader. Everything is computed in FACE-LOCAL space (meters from the face's
 * left edge / from the building base, derived from the per-instance scale of
 * the unit box), so window grids are quantized to fit each facade exactly —
 * no half panes clipped at building corners.
 *
 * Per building (hashed from its stable instance translation) one of three
 * facade styles is chosen:
 *   0 — office grid: regular mid-size panes
 *   1 — punched windows: smaller panes, more wall
 *   2 — glass curtain wall: floor-to-ceiling glass with mullions
 *
 * The panes darken the diffuse color in ALL themes (glassy facades by day) and
 * add the theme's emissive window glow at night. A bundled CC0 concrete map
 * breaks up flat wall color, and a fake contact-AO band grounds each building.
 *
 * Keeps instancing intact — three still injects its instancing chunks.
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
  const concrete = concreteTextures()

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWinEnabled = win.enabled
    shader.uniforms.uWinColor = win.color
    shader.uniforms.uWinIntensity = win.intensity
    shader.uniforms.uShopEnabled = win.shopEnabled
    shader.uniforms.uShopColor = win.shopColor
    shader.uniforms.uShopIntensity = win.shopIntensity
    shader.uniforms.uConcreteMap = { value: concrete.map }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vONormNW;
         varying float vBldHNW;
         varying vec2 vFaceNW;
         varying float vFaceWNW;
         varying float vSeedNW;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         #ifdef USE_INSTANCING
           vec3 dimsNW = vec3( instanceMatrix[0][0], instanceMatrix[1][1], instanceMatrix[2][2] );
           vBldHNW = dimsNW.y;
           // face-local meters: x from the face's min edge, y from the base
           float horizNW = abs( normal.x ) > 0.5
             ? ( position.z + 0.5 ) * dimsNW.z
             : ( position.x + 0.5 ) * dimsNW.x;
           vFaceNW = vec2( horizNW, ( position.y + 0.5 ) * dimsNW.y );
           vFaceWNW = abs( normal.x ) > 0.5 ? dimsNW.z : dimsNW.x;
           // stable per-building seed from the instance translation
           vSeedNW = fract( sin( dot( instanceMatrix[3].xz, vec2(127.1,311.7) ) ) * 43758.5453 );
         #else
           vBldHNW = 0.0;
           vFaceNW = vec2( 0.0 );
           vFaceWNW = 1.0;
           vSeedNW = 0.0;
         #endif
         vONormNW = normal;`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vONormNW;
         varying float vBldHNW;
         varying vec2 vFaceNW;
         varying float vFaceWNW;
         varying float vSeedNW;
         uniform float uWinEnabled;
         uniform vec3 uWinColor;
         uniform float uWinIntensity;
         uniform float uShopEnabled;
         uniform vec3 uShopColor;
         uniform float uShopIntensity;
         uniform sampler2D uConcreteMap;
         float hashNW( vec2 p ){ return fract( sin( dot( p, vec2(127.1,311.7) ) ) * 43758.5453 ); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           float upNW = abs( vONormNW.y );
           // quantize the interpolated seed — raw varyings wiggle by ulps across
           // a triangle, and sin-based hashes amplify that into per-pixel dither
           float seedQ = floor( vSeedNW * 1024.0 + 0.5 ) / 1024.0;
           // concrete grain everywhere (walls face-local, roofs reuse face coords)
           vec3 grain = texture2D( uConcreteMap, vFaceNW / 3.1 ).rgb;
           diffuseColor.rgb *= mix( vec3( 1.0 ), grain / 0.55, 0.55 );
           if ( upNW < 0.5 ) {
             // ---- facade style from the per-building seed ----
             float colW; float paneW; float paneH; float rowH = 3.0;
             if ( seedQ < 0.4 )      { colW = 2.2; paneW = 0.60; paneH = 0.52; }
             else if ( seedQ < 0.75 ){ colW = 2.8; paneW = 0.36; paneH = 0.44; }
             else                    { colW = 1.5; paneW = 0.90; paneH = 0.86; rowH = 2.6; }
             // quantized grid: whole columns only, margins keep panes off corners
             float m = 0.45;
             float availW = max( vFaceWNW - 2.0 * m, 0.001 );
             float nCols = max( 1.0, floor( availW / colW ) );
             float cw = availW / nCols;
             float cx = ( vFaceNW.x - m ) / cw;
             float inX = step( 0.0, cx ) * step( cx, nCols );
             float cyRaw = ( vFaceNW.y - 0.9 ) / rowH;
             float nRows = floor( max( vBldHNW - 1.5, 0.0 ) / rowH );
             float inY = step( 0.0, cyRaw ) * step( cyRaw, nRows );
             float fx = fract( cx );
             float fy = fract( cyRaw );
             float pane = inX * inY
               * step( 0.5 - paneW * 0.5, fx ) * step( fx, 0.5 + paneW * 0.5 )
               * step( 0.5 - paneH * 0.5, fy ) * step( fy, 0.5 + paneH * 0.5 );
             // shopfront zone replaces regular facade at street level
             float shopZone = uShopEnabled
               * step( vFaceNW.y, ${SHOP_HEIGHT.toFixed(1)} )
               * step( ${SHOP_MIN_BUILDING_HEIGHT.toFixed(1)}, vBldHNW );
             pane *= ( 1.0 - shopZone );
             // glassy panes: darker than the wall but with a sky-reflection lift
             // so windows still read on shadowed facades
             vec3 glassNW = diffuseColor.rgb * 0.32 + vec3( 0.05, 0.08, 0.13 );
             diffuseColor.rgb = mix( diffuseColor.rgb, glassNW, pane * 0.85 );
             vPaneNW = pane;
             vShopZoneNW = shopZone;
             vSeedQNW = seedQ;
             vColRowNW = vec2( floor( cx ), floor( cyRaw ) );
             // fake contact occlusion grounds the building
             diffuseColor.rgb *= mix( 0.78, 1.0, smoothstep( 0.0, 2.4, vFaceNW.y ) );
           } else {
             // roofs: darker, matte
             diffuseColor.rgb *= 0.85;
           }
         }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         if ( abs( vONormNW.y ) < 0.5 ) {
           if ( uWinEnabled > 0.5 && vPaneNW > 0.0 ) {
             // per-window lit/dark, stable per building via the quantized seed
             float lit = step( 0.42, hashNW( vColRowNW + vec2( vSeedQNW * 97.0, 0.0 ) ) );
             totalEmissiveRadiance += uWinColor * vPaneNW * lit * uWinIntensity;
           }
           if ( vShopZoneNW > 0.5 ) {
             float shopW = 4.8;
             float sx = fract( vFaceNW.x / shopW );
             // wide, always-lit display windows below a signage stripe
             float spane = step( 0.06, sx ) * step( sx, 0.94 )
               * step( 0.15, vFaceNW.y ) * step( vFaceNW.y, ${(SHOP_HEIGHT * 0.78).toFixed(2)} );
             float sign = step( ${(SHOP_HEIGHT * 0.85).toFixed(2)}, vFaceNW.y )
               * step( vFaceNW.y, ${(SHOP_HEIGHT * 0.97).toFixed(2)} );
             // vary the sign tint per building so streets don't repeat
             vec3 tint = mix( uShopColor, uShopColor.gbr, step( 0.5, vSeedQNW ) );
             totalEmissiveRadiance += tint * ( spane * 0.6 + sign ) * uShopIntensity;
           }
         }`
      )
      // scratch "varyings" written in color_fragment, read in emissive — plain
      // globals within the fragment shader, declared next to the real varyings
      .replace(
        'float hashNW( vec2 p )',
        `float vPaneNW = 0.0;
         float vShopZoneNW = 0.0;
         float vSeedQNW = 0.0;
         vec2 vColRowNW = vec2( 0.0 );
         float hashNW( vec2 p )`
      )
  }

  return { material, win }
}
