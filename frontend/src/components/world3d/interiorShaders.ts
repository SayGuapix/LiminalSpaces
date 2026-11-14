// ==========================================
// interiorShaders.ts - TEXTURAS PROCEDURALES DE LOS INTERIORES
// ==========================================
// Sin imágenes: el detalle sale del shader, a partir de la posición en el mapa y de la
// orientación de cada cara. Como las dos copias de un interior (la casa real y el mapa
// lejano) usan las mismas coordenadas del mapa, las texturas coinciden y el portal no
// se nota.
//
// - Backrooms: papel tapiz amarillo con rayas, rombos, uniones entre tiras, manchas de
//   humedad y zócalo; alfombra con fibra y parches húmedos; techo de placas acústicas
//   con perfiles, puntitos y alguna placa manchada.
// - Poolrooms: azulejos de 20 cm con boquilla y leve variación entre piezas; en el fondo
//   de las piscinas, cáusticas de luz que se mueven.
// - Pasillo de la nube: pintura blanca lisa, moldura y zócalo de madera oscura y
//   alfombra verde.
// - Agua: ondas que se mueven y más opaca al mirarla de lado.
//
// El detalle fino se desvanece a lo lejos (fwidth) para que no titile. Se monta sobre
// MeshBasicMaterial (onBeforeCompile): conserva el color horneado por vértice, el tinte
// de noche y la neblina.

import * as THREE from "three";
import type { InteriorKind } from "./liminal";

/** Tipo de superficie (atributo `surface` de cada vértice). */
export const SURFACE = { wall: 0, floor: 1, ceiling: 2, prop: 3, poolFloor: 4 } as const;

/** Tiempo compartido por las cáusticas y el agua. */
export const interiorTime = { value: 0 };

const NOISE = /* glsl */ `
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { return vn(p) * 0.5 + vn(p * 2.03) * 0.25 + vn(p * 4.01) * 0.125 + vn(p * 8.1) * 0.0625; }
  // 1 lejos de las líneas de una cuadrícula de periodo 1 y 0 sobre ellas (ancho w), suavizado.
  float gridMask(vec2 uv, float w) {
    vec2 fw = max(fwidth(uv), vec2(1e-4));
    vec2 g = abs(fract(uv - 0.5) - 0.5);
    vec2 l = smoothstep(vec2(w) - fw, vec2(w) + fw, g);
    return min(l.x, l.y);
  }
  // 1 cuando el patrón se ve grande en pantalla y 0 cuando sería más chico que un píxel.
  float detail(vec2 uv) {
    vec2 fw = fwidth(uv);
    return 1.0 - smoothstep(0.2, 0.7, max(fw.x, fw.y));
  }
`;

const BACKROOMS = /* glsl */ `
  vec3 surfaceTint(vec2 uv, vec3 p, float surface) {
    vec3 tint = vec3(1.0);
    if (surface < 0.5) {
      // Papel tapiz.
      float y = p.y;
      float u = uv.x;
      tint *= 1.0 - 0.035 * (0.5 + 0.5 * sin(u * 6.2831 * 7.0)) * detail(uv * 7.0);
      vec2 q = vec2(u * 3.0, y * 2.2 + 0.5 * mod(floor(u * 3.0), 2.0));
      vec2 c = abs(fract(q) - 0.5);
      float diamond = 1.0 - smoothstep(0.0, 0.05 + fwidth(q.x), abs(c.x + c.y - 0.32));
      tint *= 1.0 - 0.07 * diamond * detail(q);
      float s = abs(fract(u / 0.53 + 0.5) - 0.5) * 0.53;
      tint *= 1.0 - 0.14 * (1.0 - smoothstep(0.002, 0.002 + fwidth(u) * 1.5, s)) * detail(uv * 4.0);
      // Manchas de humedad que suben desde el piso y bajan desde el techo.
      float st = fbm(uv * vec2(0.9, 0.6) + 3.1);
      float zone = smoothstep(1.3, 0.1, y) + smoothstep(1.7, 2.6, y);
      float stain = smoothstep(0.56, 0.7, st) * zone;
      float ring = (1.0 - smoothstep(0.0, 0.02, abs(st - 0.57))) * zone;
      tint = mix(tint, tint * vec3(0.8, 0.7, 0.48), stain * 0.6);
      tint *= 1.0 - 0.18 * ring;
      // Mugre junto al piso y zócalo oscuro.
      tint *= 0.86 + 0.14 * smoothstep(0.1, 0.6, y);
      float base = 1.0 - smoothstep(0.11, 0.11 + fwidth(y), y);
      tint = mix(tint, vec3(0.6, 0.53, 0.36), base * step(-0.01, y));
    } else if (surface < 1.5 || surface > 3.5) {
      // Alfombra húmeda.
      tint *= 1.0 + (vn(uv * 55.0) - 0.5) * 0.2 * detail(uv * 55.0);
      tint *= 1.0 + (vn(uv * 13.0) - 0.5) * 0.1;
      tint *= 0.9 + 0.2 * fbm(uv * 1.7);
      float damp = smoothstep(0.6, 0.76, fbm(uv * 0.35 + 7.0));
      tint *= mix(vec3(1.0), vec3(0.7, 0.66, 0.58), damp);
    } else if (surface < 2.5) {
      // Placas acústicas de 60 cm, perfiles metálicos, puntitos y alguna placa manchada.
      vec2 t = uv / 0.6;
      tint *= mix(0.8, 1.0, gridMask(t, 0.025));
      tint *= 1.0 - 0.14 * step(0.8, h21(floor(uv * 70.0))) * detail(uv * 70.0);
      vec2 id = floor(t);
      float dirty = step(0.88, h21(id + 11.0));
      float blot = 1.0 - smoothstep(0.1, 0.45, length(fract(t) - 0.5 + (vec2(h21(id), h21(id + 3.0)) - 0.5) * 0.3));
      tint = mix(tint, tint * vec3(0.82, 0.7, 0.46), blot * dirty * 0.7);
    } else {
      tint *= 0.94 + 0.12 * vn(uv * 12.0);
    }
    return tint;
  }
`;

const POOLROOMS = /* glsl */ `
  float caustic(vec2 p, float t) {
    vec2 q = p * 1.6;
    float a = sin(q.x * 2.1 + t * 0.9 + sin(q.y * 1.7 + t * 0.6) * 1.3);
    float b = sin(q.y * 2.3 - t * 0.8 + sin(q.x * 1.4 - t * 0.5) * 1.2);
    return pow(clamp(1.0 - abs(a + b) * 0.5, 0.0, 1.0), 6.0);
  }
  vec3 surfaceTint(vec2 uv, vec3 p, float surface) {
    vec3 tint = vec3(1.0);
    if (surface > 2.5 && surface < 3.5) return vec3(0.96 + 0.08 * vn(uv * 10.0));
    // Azulejos de 20 cm: boquilla gris, piezas apenas distintas y centro más claro.
    vec2 t = uv / 0.2;
    float d = detail(t);
    float grout = gridMask(t, 0.04);
    vec2 e = fract(t) - 0.5;
    float tile = (0.97 + 0.05 * h21(floor(t))) * (1.0 + 0.035 * (1.0 - smoothstep(0.2, 0.5, max(abs(e.x), abs(e.y)))));
    tint *= mix(0.94, tile, d);
    tint *= mix(mix(0.8, 0.9, 1.0 - d), 1.0, grout);
    tint *= mix(vec3(1.0), vec3(0.93, 0.97, 1.0), 1.0 - grout);
    // Bajo el agua: más azul y con cáusticas.
    if (p.y < -0.02) {
      tint *= vec3(0.78, 0.93, 0.98);
      tint += vec3(0.22, 0.3, 0.3) * caustic(p.xz, uTime);
    }
    return tint;
  }
`;

const CLOUDHALL = /* glsl */ `
  vec3 surfaceTint(vec2 uv, vec3 p, float surface) {
    vec3 tint = vec3(1.0);
    if (surface < 0.5) {
      // Pintura lisa, apenas despareja; moldura de madera oscura bajo el techo y zócalo.
      tint *= 0.97 + 0.05 * fbm(uv * 0.8);
      float y = p.y;
      float fw = fwidth(y);
      float crown = smoothstep(2.47 - fw, 2.47 + fw, y) * (1.0 - smoothstep(2.71 - fw, 2.71 + fw, y));
      float base = (1.0 - smoothstep(0.1 - fw, 0.1 + fw, y)) * step(-0.01, y);
      tint = mix(tint, vec3(0.36, 0.22, 0.13), max(crown, base));
    } else if (surface < 1.5 || surface > 3.5) {
      // Alfombra verde de pelo corto.
      tint *= 1.0 + (vn(uv * 60.0) - 0.5) * 0.18 * detail(uv * 60.0);
      tint *= 0.93 + 0.12 * fbm(uv * 1.3);
    } else if (surface < 2.5) {
      tint *= 0.98 + 0.03 * vn(uv * 4.0);
    } else {
      tint *= 0.96 + 0.06 * vn(uv * 12.0);
    }
    return tint;
  }
`;

const TINTS: Record<InteriorKind, string> = { backrooms: BACKROOMS, poolrooms: POOLROOMS, cloudhall: CLOUDHALL };

/** Material de paredes, pisos, techos y objetos de un interior. */
export function surfaceMaterial(kind: InteriorKind) {
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = interiorTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float surface;
        varying float vSurface;
        varying vec3 vLocal;
        varying vec3 vLocalNormal;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSurface = surface;
        vLocal = position;
        vLocalNormal = normal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        varying float vSurface;
        varying vec3 vLocal;
        varying vec3 vLocalNormal;
        ${NOISE}
        ${TINTS[kind]}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 n = abs(normalize(vLocalNormal));
          vec2 uv = n.y > 0.5 ? vLocal.xz : (n.x > 0.5 ? vLocal.zy : vLocal.xy);
          diffuseColor.rgb *= surfaceTint(uv, vLocal, vSurface);
        }`
      );
  };
  material.customProgramCacheKey = () => `interior-${kind}`;
  return material;
}

/** Agua de las piscinas: ondas que se mueven y más opaca al mirarla de lado. */
export function waterMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: "#8fd3dd", transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = interiorTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;\nvarying vec3 vWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;\nvWorld = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying vec3 vLocal;\nvarying vec3 vWorld;\n${NOISE}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 p = vLocal.xz;
          float r = vn(p * 3.0 + vec2(uTime * 0.25, uTime * 0.1)) + vn(p * 5.3 - vec2(uTime * 0.18, -uTime * 0.3));
          diffuseColor.rgb *= 0.88 + 0.22 * r;
          // Destellos finos donde las ondas se cruzan.
          diffuseColor.rgb += vec3(0.12) * smoothstep(1.45, 1.75, r);
          float facing = abs(normalize(cameraPosition - vWorld).y);
          diffuseColor.a = mix(0.82, 0.38, facing);
        }`
      );
  };
  material.customProgramCacheKey = () => "interior-water";
  return material;
}
