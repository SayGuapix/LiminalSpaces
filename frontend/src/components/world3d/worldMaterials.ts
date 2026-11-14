// ==========================================
// worldMaterials.ts - MATERIALES COMPARTIDOS DEL MAPA
// ==========================================
// Son instancias únicas (hay un solo Canvas); ThemeSky las actualiza en cada frame
// con la mezcla de temas, la neblina, el tiempo y la onda.
//
// Sombras del sol: los shaders propios del mundo (plataformas y pasto) leen el mapa de
// sombras de three con los fragmentos de abajo (lights: true).

import * as THREE from "three";

// --- Sombras del sol en shaders propios ---

/** Dirección hacia el sol (la misma que la luz direccional principal de World3D). */
export const SUN_DIRECTION = new THREE.Vector3(3, 8, 6).normalize();

/** Cuánto oscurece la sombra: más de día que de noche. */
export const SHADOW_STRENGTH = { dark: 0.35, light: 0.5 };

/** Antes de main() en el vertex shader. */
export const shadowVertexPars = /* glsl */ `
  #include <common>
  #include <shadowmap_pars_vertex>
`;

/** Dentro de main(), con `vec4 worldPosition` y `vec3 transformedNormal` (espacio de vista) ya definidos. */
export const shadowVertex = /* glsl */ `
  #include <shadowmap_vertex>
`;

/** Antes de main() en el fragment shader: sunShadow() da 1 al sol y menos en la sombra. */
export const shadowFragmentPars = /* glsl */ `
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  uniform float uShadowStrength;
  float sunShadow() { return mix(1.0, getShadowMask(), uShadowStrength); }
`;

/** Uniforms que necesita un ShaderMaterial con lights: true para leer las sombras. */
export function shadowUniforms() {
  return {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    uShadowStrength: { value: SHADOW_STRENGTH.dark },
  };
}
