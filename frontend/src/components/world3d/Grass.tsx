// ==========================================
// Grass.tsx - EL PRADO: PASTO Y COLINAS
// ==========================================
// Relieve: las colinas del prado liminal (liminal.ts). El suelo cercano es una malla
// con el relieve ya aplicado y las briznas calculan la misma altura en el shader.
// El sendero de la torre queda de tierra (sin briznas) y de noche los faroles dejan
// charcos de luz cálida y difusa sobre el pasto.
//
// Rendimiento primero:
// - Las briznas son una sola malla instanciada (un draw call): cada brizna son 5
//   vértices y su forma, color y movimiento salen del shader.
// - El campo de briznas sigue al jugador en anillos (RINGS): un parche cuadrado denso
//   que se repite al moverse (como la nube de partículas) y anillos más amplios, con
//   briznas más escasas y grandes, que llegan hasta ~160 m. Todo en el mismo draw call.
//   Más allá queda un suelo con textura de pasto procedural.
// - Viento con ondas que recorren el campo; quieto con prefers-reduced-motion.
// - Las briznas se aplastan y se apartan bajo los pies del jugador al caminar por el pasto.
// - Los colores se mezclan entre día (modo claro) y noche (modo oscuro) con la misma
//   transición del resto del mundo.
// - Luz: reciben la sombra del sol (casas y cercas, horneada una vez) y, mirando hacia
//   el sol, las puntas se iluminan a contraluz como hojas translúcidas.
// - La cantidad de briznas depende del nivel de calidad (quality.ts).

import { useEffect, useMemo, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { LAMPS_GLSL, PATH_GLSL, ROOMS_GLSL, SKY, TERRAIN_GLSL, hillsUniform, lampUniforms, pathUniforms, roomUniforms, terrainHeight } from "./liminal";
import { viewFollowers } from "./viewFollowers";
import { SHADOW_STRENGTH, SUN_DIRECTION, shadowFragmentPars, shadowUniforms, shadowVertex, shadowVertexPars } from "./worldMaterials";

/**
 * Anillos de briznas alrededor de la cámara (lado del parche en m, parte del total de
 * briznas, escala de ancho y alto). El primero es el parche denso; los siguientes cubren
 * más lejos con briznas más escasas y más grandes (de lejos la perspectiva las junta) y
 * dejan hueco donde ya está el anterior, con un fundido cruzado en el borde.
 */
const RINGS = [
  { patch: 44, share: 1, width: 1, height: 1 },
  { patch: 120, share: 0.55, width: 2.2, height: 1.3 },
  { patch: 320, share: 0.45, width: 4.5, height: 1.6 },
];

// Colores de día y de noche (base de la brizna, punta y suelo). De día, el verde
// intenso y saturado de los prados liminales; de noche, verde azulado de luna.
const DAY = { base: "#3f8f1c", tip: "#9bd84a", ground: "#5aa52c", groundDark: "#4a9124" };
const NIGHT = { base: "#050d0c", tip: "#1f3a33", ground: "#0d1f1a", groundDark: "#081612" };
/** Tierra del sendero. */
const DIRT = { day: "#c9b48a", night: "#1d1c1a" };
const LAMP_LIGHT = "#ffb066"; // luz cálida (sodio) de los faroles

// Ruido de valor suave, compartido por el suelo y las briznas.
const noise = /* glsl */ `
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.7) * 0.3 + vnoise(p * 7.1) * 0.1; }
`;

const fogFade = /* glsl */ `
  uniform vec3 uBg;
  uniform float uFadeNear;
  uniform float uFadeFar;
  vec3 applyFade(vec3 col, vec3 world) {
    return mix(col, uBg, smoothstep(uFadeNear, uFadeFar, distance(world.xz, cameraPosition.xz)));
  }
`;

// --- Briznas ---

const bladeVertex = /* glsl */ `
  attribute vec4 aOffset; // x, z, giro, fase
  attribute vec3 aShape;  // alto, ancho, inclinación
  attribute vec2 aRing;   // lado del parche, mitad del lado del anillo anterior (0 si es el primero)
  uniform vec2 uCamera;
  uniform float uTime;
  uniform vec3 uPlayer; // x, altura de los pies, z
  varying float vY;
  varying float vRand;
  varying vec3 vWorld;
  ${noise}
  ${TERRAIN_GLSL}
  ${PATH_GLSL}
  ${ROOMS_GLSL}
  ${shadowVertexPars}
  void main() {
    // Posición dentro del parche que acompaña a la cámara.
    float halfPatch = aRing.x * 0.5;
    vec2 rel = mod(aOffset.xy - uCamera + halfPatch, aRing.x) - halfPatch;
    vec2 base = uCamera + rel;
    float d = max(abs(rel.x), abs(rel.y));
    float edge = 1.0 - smoothstep(halfPatch * 0.7, halfPatch - 0.5, d);
    // Hueco donde ya crece el anillo anterior (se cruzan en su borde desvanecido).
    if (aRing.y > 0.0) edge *= smoothstep(aRing.y * 0.7, aRing.y - 0.5, d);

    // Zonas con pasto más alto y más bajo, para que no se vea uniforme.
    float patchiness = 0.55 + vnoise(base * 0.12) * 0.9;
    // Sin briznas en el sendero ni dentro de las casas que se pueden entrar.
    float groundY = terrainHeight(base);
    float h = aShape.x * patchiness * edge * (1.0 - pathMask(base)) * (1.0 - insideRoom(base));
    // Por las paredes del agujero no crece pasto.
    h *= step(-0.6, groundY);
    float y = position.y;
    float w = aShape.y * (1.0 - y * 0.92);
    float c = cos(aOffset.z);
    float s = sin(aOffset.z);
    vec3 p = vec3(position.x * w * c, y * h, position.x * w * s);

    // Viento: ondas que recorren el campo y un temblor propio de cada brizna.
    float gust = vnoise(base * 0.06 + vec2(uTime * 0.25, uTime * 0.1));
    float flutter = sin(uTime * 2.3 + aOffset.w) * 0.25;
    float bend = (aShape.z + gust * 0.55 + flutter * gust) * y * y * h;
    p.xz += vec2(0.92, 0.38) * bend;
    p.y -= bend * bend * 0.35; // al doblarse, la punta baja un poco

    // Bajo los pies del jugador las briznas se aplastan y se apartan.
    float near = 1.0 - smoothstep(0.25, 1.0, distance(base, uPlayer.xz));
    float onGrass = 1.0 - smoothstep(0.15, 0.6, uPlayer.y - groundY);
    float press = near * onGrass;
    vec2 away = normalize(base - uPlayer.xz + vec2(0.0001));
    p.xz += away * press * 0.35 * y * h;
    p.y *= 1.0 - press * 0.6;

    vec3 world = vec3(base.x, groundY, base.y) + p;
    vWorld = world;
    vY = y;
    vRand = fract(aOffset.w * 0.159);
    // La sombra se mide con la normal del suelo (hacia arriba).
    vec4 worldPosition = vec4(world, 1.0);
    vec3 transformedNormal = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    ${shadowVertex}
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const bladeFragment = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uTip;
  varying float vY;
  varying float vRand;
  uniform vec3 uSun;
  uniform float uTranslucency;
  uniform vec3 uLampColor;
  varying vec3 vWorld;
  ${fogFade}
  ${LAMPS_GLSL}
  ${shadowFragmentPars}
  void main() {
    // Más oscuro abajo (sombra entre briznas) y algo de variación de tono por brizna.
    vec3 col = mix(uBase, uTip, pow(vY, 1.3));
    col *= 0.82 + vRand * 0.32;
    col = mix(col, col * vec3(1.08, 1.0, 0.82), step(0.82, vRand)); // algunas más secas
    float lit = sunShadow();
    col *= lit;
    // Contraluz: mirando hacia el sol, la luz atraviesa las puntas.
    vec3 toEye = normalize(cameraPosition - vWorld);
    float back = pow(max(dot(-toEye, uSun), 0.0), 3.0) * vY * vY;
    col += uTip * back * uTranslucency * step(0.999, lit);
    col += uLampColor * lampGlow(vWorld.xz) * (0.25 + vY * 0.5);
    gl_FragColor = vec4(applyFade(col, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

// --- Suelo ---

const groundVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  ${shadowVertexPars}
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec3 transformedNormal = normalMatrix * normal;
    ${shadowVertex}
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const groundFragment = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uGroundDark;
  uniform vec3 uDirt;
  uniform vec3 uSun;
  uniform vec3 uLampColor;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  ${noise}
  ${fogFade}
  ${PATH_GLSL}
  ${LAMPS_GLSL}
  ${shadowFragmentPars}
  void main() {
    // Manchas grandes y detalle fino: textura de pasto visto de lejos.
    float n = fbm(vWorld.xz * 0.18) * 0.7 + fbm(vWorld.xz * 1.7) * 0.3;
    vec3 col = mix(uGroundDark, uGround, n);
    col = mix(col, uDirt * (0.9 + n * 0.2), pathMask(vWorld.xz));
    // Las colinas: más claras de cara al sol, más oscuras del otro lado.
    float facing = dot(normalize(vNormalW), uSun);
    col *= mix(0.78, 1.08, clamp(facing * 0.5 + 0.5, 0.0, 1.0));
    col *= sunShadow();
    col += uLampColor * lampGlow(vWorld.xz) * 0.35;
    // Hacia el fondo del agujero, cada vez más negro.
    col *= pow(smoothstep(-70.0, -0.5, vWorld.y), 1.5);
    gl_FragColor = vec4(applyFade(col, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Malla del relieve: colinas, montañas del fondo y el agujero (centrada en el mapa). */
const TERRAIN = { x: 12, z: 6, size: 600, segments: 240 };

function terrainGeometry() {
  const geometry = new THREE.PlaneGeometry(TERRAIN.size, TERRAIN.size, TERRAIN.segments, TERRAIN.segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(TERRAIN.x, 0, TERRAIN.z);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geometry.computeVertexNormals();
  return geometry;
}

/** Suelo liso hasta el horizonte, con un hueco donde está la malla del relieve (no tapa el agujero). */
function outerGroundGeometry() {
  const FAR = 1000;
  const half = TERRAIN.size / 2 - 2; // se solapan un poco
  // En el plano XY de la figura, y = -z del mundo (luego se gira sobre X).
  const shape = new THREE.Shape([
    new THREE.Vector2(-FAR, -FAR),
    new THREE.Vector2(FAR, -FAR),
    new THREE.Vector2(FAR, FAR),
    new THREE.Vector2(-FAR, FAR),
  ]);
  shape.holes.push(
    new THREE.Path([
      new THREE.Vector2(TERRAIN.x - half, -TERRAIN.z - half),
      new THREE.Vector2(TERRAIN.x - half, -TERRAIN.z + half),
      new THREE.Vector2(TERRAIN.x + half, -TERRAIN.z + half),
      new THREE.Vector2(TERRAIN.x + half, -TERRAIN.z - half),
    ])
  );
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.05, 0);
  return geometry;
}

/** Brizna: 5 vértices (dos tramos y la punta), x en [-0.5, 0.5] e y en [0, 1]. */
function bladeGeometry(nearCount: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.42, 0.5, 0, 0.42, 0.5, 0, 0, 1, 0], 3)
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);

  const counts = RINGS.map((r) => Math.round(nearCount * r.share));
  const count = counts.reduce((a, b) => a + b, 0);
  const offsets = new Float32Array(count * 4);
  const shapes = new Float32Array(count * 3);
  const rings = new Float32Array(count * 2);
  let i = 0;
  RINGS.forEach((ring, r) => {
    const prevHalf = r > 0 ? RINGS[r - 1].patch * 0.5 : 0;
    for (let n = 0; n < counts[r]; n++, i++) {
      offsets[i * 4] = Math.random() * ring.patch;
      offsets[i * 4 + 1] = Math.random() * ring.patch;
      offsets[i * 4 + 2] = Math.random() * Math.PI;
      offsets[i * 4 + 3] = Math.random() * 100;
      shapes[i * 3] = (0.16 + Math.pow(Math.random(), 1.6) * 0.32) * ring.height; // alto (césped corto)
      shapes[i * 3 + 1] = (0.045 + Math.random() * 0.045) * ring.width; // ancho
      shapes[i * 3 + 2] = (Math.random() - 0.3) * 0.5; // inclinación
      rings[i * 2] = ring.patch;
      rings[i * 2 + 1] = prevHalf;
    }
  });
  geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 4));
  geometry.setAttribute("aShape", new THREE.InstancedBufferAttribute(shapes, 3));
  geometry.setAttribute("aRing", new THREE.InstancedBufferAttribute(rings, 2));
  geometry.instanceCount = count;
  return geometry;
}

export interface GrassProps {
  /** Mezcla de temas (0 = noche, 1 = día). */
  blend: MutableRefObject<number>;
  animated: boolean;
  /** Briznas alrededor del jugador (según el nivel de calidad). */
  blades: number;
  fog: { near: number; far: number };
}

/** Brillo a contraluz de las puntas: de día se nota, de noche casi nada. */
const TRANSLUCENCY = { dark: 0.05, light: 0.45 };

export default function Grass({ blend, animated, blades, fog }: GrassProps) {
  const count = blades;
  const geometry = useMemo(() => bladeGeometry(count), [count]);

  const bladeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: bladeVertex,
        fragmentShader: bladeFragment,
        side: THREE.DoubleSide,
        lights: true,
        uniforms: {
          ...shadowUniforms(),
          uSun: { value: SUN_DIRECTION.clone() },
          uTranslucency: { value: TRANSLUCENCY.dark },
          uHills: { value: hillsUniform() },
          ...pathUniforms(),
          ...roomUniforms(),
          ...lampUniforms(),
          uLampColor: { value: new THREE.Color(LAMP_LIGHT) },
          uCamera: { value: new THREE.Vector2() },
          uPlayer: { value: new THREE.Vector3(0, 10, 0) },
          uTime: { value: 0 },
          uBase: { value: new THREE.Color() },
          uTip: { value: new THREE.Color() },
          uBg: { value: new THREE.Color() },
          uFadeNear: { value: fog.near },
          uFadeFar: { value: fog.far },
        },
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groundMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
        lights: true,
        uniforms: {
          ...shadowUniforms(),
          ...pathUniforms(),
          ...lampUniforms(),
          uLampColor: { value: new THREE.Color(LAMP_LIGHT) },
          uSun: { value: SUN_DIRECTION.clone() },
          uDirt: { value: new THREE.Color() },
          uGround: { value: new THREE.Color() },
          uGroundDark: { value: new THREE.Color() },
          uBg: { value: new THREE.Color() },
          uFadeNear: { value: fog.near },
          uFadeFar: { value: fog.far },
        },
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const terrain = useMemo(() => terrainGeometry(), []);
  const outer = useMemo(() => outerGroundGeometry(), []);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry]
  );
  useEffect(
    () => () => {
      terrain.dispose();
      outer.dispose();
    },
    [terrain, outer]
  );
  // El parche de briznas sigue también a la cámara de los portales (viewFollowers).
  useEffect(() => {
    const follow = (camera: THREE.Camera) => bladeMaterial.uniforms.uCamera.value.set(camera.position.x, camera.position.z);
    viewFollowers.add(follow);
    return () => {
      viewFollowers.delete(follow);
    };
  }, [bladeMaterial]);
  useEffect(
    () => () => {
      bladeMaterial.dispose();
      groundMaterial.dispose();
    },
    [bladeMaterial, groundMaterial]
  );

  const colors = useMemo(
    () => ({
      day: Object.fromEntries(Object.entries(DAY).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof typeof DAY, THREE.Color>,
      night: Object.fromEntries(Object.entries(NIGHT).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof typeof NIGHT, THREE.Color>,
      bgDay: new THREE.Color(SKY.day.horizon),
      bgNight: new THREE.Color(SKY.night.horizon),
      dirtDay: new THREE.Color(DIRT.day),
      dirtNight: new THREE.Color(DIRT.night),
    }),
    []
  );

  useFrame(({ camera }, delta) => {
    const b = blend.current;
    const bu = bladeMaterial.uniforms;
    const gu = groundMaterial.uniforms;
    bu.uCamera.value.set(camera.position.x, camera.position.z);
    // Altura de los pies (la cámara va a 1,65 m sobre ellos).
    bu.uPlayer.value.set(camera.position.x, camera.position.y - 1.65, camera.position.z);
    if (animated) bu.uTime.value += Math.min(delta, 0.05);
    bu.uBase.value.copy(colors.night.base).lerp(colors.day.base, b);
    bu.uTip.value.copy(colors.night.tip).lerp(colors.day.tip, b);
    gu.uGround.value.copy(colors.night.ground).lerp(colors.day.ground, b);
    gu.uGroundDark.value.copy(colors.night.groundDark).lerp(colors.day.groundDark, b);
    bu.uTranslucency.value = THREE.MathUtils.lerp(TRANSLUCENCY.dark, TRANSLUCENCY.light, b);
    gu.uDirt.value.copy(colors.dirtNight).lerp(colors.dirtDay, b);
    // Los faroles solo alumbran de noche.
    bu.uLampGlow.value = gu.uLampGlow.value = Math.pow(1 - b, 2);
    for (const u of [bu, gu]) {
      u.uShadowStrength.value = THREE.MathUtils.lerp(SHADOW_STRENGTH.dark, SHADOW_STRENGTH.light, b);
      u.uBg.value.copy(colors.bgNight).lerp(colors.bgDay, b);
      u.uFadeNear.value = fog.near;
      u.uFadeFar.value = fog.far;
    }
  });

  return (
    <>
      {/* Lo cercano con colinas; más allá, un plano liso hasta el horizonte. */}
      <mesh geometry={terrain} material={groundMaterial} raycast={() => null} receiveShadow />
      <mesh geometry={outer} material={groundMaterial} raycast={() => null} receiveShadow />
      {/* Las briznas se colocan en el shader: sin recorte por frustum. */}
      <mesh geometry={geometry} material={bladeMaterial} frustumCulled={false} raycast={() => null} receiveShadow />
    </>
  );
}
