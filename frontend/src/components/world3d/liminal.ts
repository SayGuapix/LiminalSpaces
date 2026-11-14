// ==========================================
// liminal.ts - EL PRADO LIMINAL (DATOS)
// ==========================================
// Un prado con estética de "espacio liminal": colinas
// redondas de pasto intenso, casas pastel sin puertas, cercas blancas y una torre de
// agua en lo alto de la colina mayor, con un sendero de tierra que sube hasta ella.
//
// Aquí solo hay datos y la altura del terreno. La misma función existe en GLSL
// (TERRAIN_GLSL) para que las briznas de pasto sigan el relieve: las dos deben
// coincidir. Las colinas están lejos del centro, así que ahí el
// pasto queda plano (y = 0).

import * as THREE from "three";
import { circleCollider, colliderFor, type Collider } from "./shared";

/** Centro del mapa (el límite caminable es un círculo de 100 m alrededor: worldMap.ts). */
const CENTER = { x: 12, z: 6 };

/** Montañas del fondo: en un anillo a 215 m, fuera del alcance del jugador (ángulos en grados). */
const MOUNTAINS: [number, number, number, number][] = [0, 35, 75, 110, 150, 185, 220, 255, 345].map((deg, i) => {
  const a = (deg * Math.PI) / 180;
  return [CENTER.x + Math.cos(a) * 215, CENTER.z + Math.sin(a) * 215, 62 + (i % 3) * 6, 22 + ((i * 7) % 4) * 4];
});

/** Colina: x, z, radio y altura. Perfil de coseno (cúpula redonda, sin bordes). */
export const HILLS: [number, number, number, number][] = [
  [-5, -52, 28, 14], // la de la torre, al fondo
  [40, -42, 22, 9],
  [-62, 24, 24, 10],
  [80, 30, 22, 8],
  [20, 70, 30, 11],
  [-35, 65, 22, 7],
  ...MOUNTAINS,
];

/**
 * El agujero: un embudo enorme justo pasado el límite del mundo (desde el borde se ve
 * hacia adentro). Las paredes se empinan al bajar y el fondo se pierde en lo negro.
 */
const HOLE_ANGLE = (-60 * Math.PI) / 180;
export const HOLE = {
  x: CENTER.x + Math.cos(HOLE_ANGLE) * 138,
  z: CENTER.z + Math.sin(HOLE_ANGLE) * 138,
  radius: 36,
  bottom: 9,
  depth: 90,
};

/** Cuánto baja el suelo por el agujero en (x, z) (0 fuera). */
function holeDepth(x: number, z: number) {
  const r = Math.hypot(x - HOLE.x, z - HOLE.z);
  if (r >= HOLE.radius) return 0;
  const t = Math.min(1, (HOLE.radius - r) / (HOLE.radius - HOLE.bottom));
  return -HOLE.depth * Math.pow(t, 1.6);
}

/** Altura del pasto en (x, z). */
export function terrainHeight(x: number, z: number) {
  let h = 0;
  for (const [hx, hz, r, height] of HILLS) {
    const t = Math.hypot(x - hx, z - hz) / r;
    if (t < 1) h += height * (0.5 + 0.5 * Math.cos(Math.PI * t));
  }
  return h + holeDepth(x, z);
}

const glslFloat = (n: number) => n.toFixed(4);

/** GLSL: terrainHeight(vec2 xz) con las colinas como uniform uHills (y el agujero fijo). */
export const TERRAIN_GLSL = /* glsl */ `
  uniform vec4 uHills[${HILLS.length}];
  float terrainHeight(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < ${HILLS.length}; i++) {
      float t = distance(p, uHills[i].xy) / uHills[i].z;
      if (t < 1.0) h += uHills[i].w * (0.5 + 0.5 * cos(3.14159265 * t));
    }
    float hr = distance(p, vec2(${glslFloat(HOLE.x)}, ${glslFloat(HOLE.z)}));
    if (hr < ${glslFloat(HOLE.radius)}) {
      float ht = min(1.0, (${glslFloat(HOLE.radius)} - hr) / ${glslFloat(HOLE.radius - HOLE.bottom)});
      h -= ${glslFloat(HOLE.depth)} * pow(ht, 1.6);
    }
    return h;
  }
`;

export const hillsUniform = () => HILLS.map(([x, z, r, h]) => new THREE.Vector4(x, z, r, h));

// --- Torre de agua y sendero ---

export const TOWER = { x: -5, z: -52 };

/** Sendero de tierra recto: desde el pie de la colina hasta la torre. */
export const PATH = { from: [-1.5, -23] as [number, number], to: [-4.2, -48.5] as [number, number], halfWidth: 0.75 };

/** GLSL: pathMask(vec2 xz), 1 sobre el sendero y 0 fuera (borde suave). */
export const PATH_GLSL = /* glsl */ `
  uniform vec4 uPath;   // desde (x, z), hasta (x, z)
  uniform float uPathHalfWidth;
  float pathMask(vec2 p) {
    vec2 a = uPath.xy;
    vec2 ab = uPath.zw - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    float d = distance(p, a + ab * t);
    return 1.0 - smoothstep(uPathHalfWidth * 0.7, uPathHalfWidth * 1.15, d);
  }
`;

export const pathUniforms = () => ({
  uPath: { value: new THREE.Vector4(PATH.from[0], PATH.from[1], PATH.to[0], PATH.to[1]) },
  uPathHalfWidth: { value: PATH.halfWidth },
});

// --- Casas ---

/**
 * - normal: maciza.
 * - enterable: hueca, con puerta en la fachada (+Z local) y por dentro mucho más grande
 *   (interiorMaps.ts). Giro 0 y 9 × 7 m: ahí cabe el recibidor del interior.
 * - upsideDown: al revés, clavada por el techo en el suelo.
 * - buried: enterrada hasta el segundo piso.
 * - floating: suspendida en el aire (sin colisión).
 */
export type HouseKind = "normal" | "enterable" | "upsideDown" | "buried" | "floating";

/** Lo que hay dentro de una casa que se puede entrar (interiorMaps.ts). */
export type InteriorKind = "backrooms" | "poolrooms" | "cloudhall";

export interface House {
  kind: HouseKind;
  interior?: InteriorKind;
  x: number;
  z: number;
  /** Giro en Y (la fachada con ventanas mira hacia +Z local). */
  rotation: number;
  width: number;
  depth: number;
  /** Pisos (cada uno de 2,8 m). */
  floors: number;
  wall: string;
  roof: string;
}

export const HOUSES: House[] = [
  // La casa amarilla grande, frente al punto de aparición: se puede entrar.
  // Adentro, el pasillo de la nube (a los Backrooms se llega cayendo por el agujero).
  { kind: "enterable", interior: "cloudhall", x: 18, z: -21, rotation: 0, width: 9, depth: 7, floors: 2, wall: "#f6e7a1", roof: "#7a4a34" },
  { kind: "normal", x: 8, z: -40, rotation: -0.15, width: 5.5, depth: 5, floors: 1, wall: "#f3ebcf", roof: "#6b4a3a" },
  // La de las Poolrooms. Mide lo mismo que la amarilla: su recibidor es igual (interiorMaps.ts).
  { kind: "enterable", interior: "poolrooms", x: -47, z: -2, rotation: 0, width: 9, depth: 7, floors: 2, wall: "#efe2c4", roof: "#5d4637" },
  { kind: "normal", x: -40, z: 42, rotation: 2.4, width: 6, depth: 5.5, floors: 2, wall: "#f4d9b0", roof: "#7d5240" },
  { kind: "normal", x: 30, z: 48, rotation: 3.0, width: 8, depth: 6, floors: 2, wall: "#f8eeb4", roof: "#6e4535" },
  { kind: "normal", x: 68, z: -12, rotation: -1.9, width: 6.5, depth: 6, floors: 1, wall: "#f1e4bd", roof: "#74503c" },
  { kind: "normal", x: 62, z: 32, rotation: -2.6, width: 7.5, depth: 6.5, floors: 2, wall: "#f6dfa8", roof: "#694232" },
  // Las raras.
  { kind: "upsideDown", x: 31, z: -31, rotation: 0.35, width: 6, depth: 5, floors: 2, wall: "#f3e3b8", roof: "#6d4636" },
  { kind: "buried", x: -30, z: 49, rotation: -0.4, width: 7, depth: 6, floors: 2, wall: "#f5dcaa", roof: "#704a38" },
  { kind: "floating", x: 58, z: 58, rotation: 0.8, width: 5, depth: 4.5, floors: 1, wall: "#f2ead2", roof: "#6a4433" },
];

/**
 * El barrio del fondo: casas sueltas en cuadrícula (calles cada FAR_BLOCK m) más allá del
 * límite del mundo, subiendo por las montañas hasta perderse en la neblina, y anillos de
 * casas bajando por las paredes del agujero. Solo se ven (sin colisión).
 */
export const FAR_RING = { x: CENTER.x, z: CENTER.z, inner: 118, outer: 250 };
const FAR_BLOCK = 26;
/** Separación entre casas a lo largo de cada anillo del agujero (m). */
const HOLE_SPACING = 10;

/** Casa del fondo: dónde va su piso, cuánto baja su base, su inclinación y cuánto se oscurece. */
export interface FarHouse extends House {
  base: number;
  sink: number;
  /** Giro completo: el de la casa en Y y luego inclinada según la pendiente del terreno. */
  quaternion: THREE.Quaternion;
  /** 1 = color normal; menos, más oscura (hondo en el agujero). */
  shade: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Normal del terreno en (x, z). */
export function terrainNormal(x: number, z: number) {
  const e = 0.5;
  const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return new THREE.Vector3(-dx, 1, -dz).normalize();
}

/** Asienta la casa inclinada según la pendiente; la base baja lo justo donde el terreno se curva. */
function onSlope(house: House): FarHouse {
  const ground = terrainHeight(house.x, house.z);
  const quaternion = new THREE.Quaternion()
    .setFromUnitVectors(UP, terrainNormal(house.x, house.z))
    .multiply(new THREE.Quaternion().setFromAxisAngle(UP, house.rotation));
  const base = ground - 0.2;
  // Puntos del borde de la planta: cuánto queda el terreno por debajo del piso inclinado.
  let gap = 0;
  for (const u of [-1, 0, 1]) {
    for (const v of [-1, 0, 1]) {
      const p = new THREE.Vector3((u * house.width) / 2, 0, (v * house.depth) / 2).applyQuaternion(quaternion);
      gap = Math.max(gap, base + p.y - terrainHeight(house.x + p.x, house.z + p.z));
    }
  }
  return { ...house, base, sink: gap + 1, quaternion, shade: 1 };
}

let farCache: FarHouse[] | null = null;

export function farHouses(): FarHouse[] {
  if (!farCache) farCache = buildFarHouses();
  return farCache;
}

/** Casas del agujero: se puede bajar hasta ellas, así que chocan (con su rango de altura). */
function holeColliders(): Collider[] {
  return farHouses()
    .filter((h) => Math.hypot(h.x - HOLE.x, h.z - HOLE.z) < HOLE.radius)
    .map((h) => {
      const top = h.floors * FLOOR_HEIGHT + roofHeight(h);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (const y of [-h.sink, top]) {
            const p = new THREE.Vector3((sx * h.width) / 2, y, (sz * h.depth) / 2).applyQuaternion(h.quaternion);
            minY = Math.min(minY, h.base + p.y);
            maxY = Math.max(maxY, h.base + p.y);
            // En planta cuenta solo la huella del piso (no lo que se inclina hacia arriba).
            if (y !== top) {
              minX = Math.min(minX, h.x + p.x);
              maxX = Math.max(maxX, h.x + p.x);
              minZ = Math.min(minZ, h.z + p.z);
              maxZ = Math.max(maxZ, h.z + p.z);
            }
          }
        }
      }
      return { minX, maxX, minZ, maxZ, minY, maxY };
    });
}

function buildFarHouses(): FarHouse[] {
  let seed = 777;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const palette = HOUSES.filter((h) => h.kind === "normal");
  const out: FarHouse[] = [];
  const n = Math.ceil(FAR_RING.outer / FAR_BLOCK);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = FAR_RING.x + i * FAR_BLOCK + (rand() - 0.5) * 6;
      const z = FAR_RING.z + j * FAR_BLOCK + (rand() - 0.5) * 6;
      const r = Math.hypot(x - FAR_RING.x, z - FAR_RING.z);
      const skip = rand() < 0.3; // solares vacíos
      const look = palette[Math.floor(rand() * palette.length)];
      const turn = Math.floor(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.12;
      const width = 6 + rand() * 3;
      const depth = 5 + rand() * 2;
      const floors = rand() < 0.6 ? 2 : 1;
      if (skip || r < FAR_RING.inner || r > FAR_RING.outer) continue;
      // El borde del agujero queda libre: ahí van sus propios anillos.
      if (Math.hypot(x - HOLE.x, z - HOLE.z) < HOLE.radius + 9) continue;
      out.push(onSlope({ kind: "normal", x, z, rotation: turn, width, depth, floors, wall: look.wall, roof: look.roof }));
    }
  }
  // Agujero: anillos de casas mirando al centro, cada vez más hondos y oscuros.
  for (let ring = 0, r = HOLE.radius - 2; r > HOLE.bottom + 4; ring++, r -= 4.5) {
    const count = Math.floor((2 * Math.PI * r) / HOLE_SPACING);
    const offset = rand() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      if (rand() < 0.15) continue;
      const a = offset + (k / count) * Math.PI * 2 + (rand() - 0.5) * 0.08;
      const x = HOLE.x + Math.cos(a) * r;
      const z = HOLE.z + Math.sin(a) * r;
      const look = palette[Math.floor(rand() * palette.length)];
      const house: House = {
        kind: "normal",
        x,
        z,
        // La fachada (+Z local) mira al centro del agujero.
        rotation: Math.atan2(HOLE.x - x, HOLE.z - z),
        width: 4.5 + rand() * 1.5,
        depth: 3.6 + rand() * 0.8,
        floors: rand() < 0.5 ? 2 : 1,
        wall: look.wall,
        roof: look.roof,
      };
      const placed = onSlope(house);
      placed.shade = THREE.MathUtils.clamp(1 + placed.base / 55, 0.06, 1);
      out.push(placed);
    }
  }
  return out;
}

export const FLOOR_HEIGHT = 2.8;
/** Cuánto bajan las paredes bajo el suelo (para que en laderas no floten). */
export const HOUSE_SINK = 1.5;
export const roofHeight = (house: House) => house.depth * 0.42;

/** Esquinas y centro de la planta de una casa, en coordenadas del mundo. */
function footprint(house: House) {
  const { x, z, width, depth, rotation } = house;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([u, v]) => {
    const lx = (u * width) / 2;
    const lz = (v * depth) / 2;
    return [x + lx * c + lz * s, z - lx * s + lz * c];
  });
}

/** Altura del piso de la casa (su origen local). */
export function houseBase(house: House) {
  const heights = footprint(house).map(([x, z]) => terrainHeight(x, z));
  const low = Math.min(...heights);
  switch (house.kind) {
    // El piso de adentro queda apenas sobre el pasto más alto: se entra sin saltar.
    case "enterable":
      return Math.max(...heights) + 0.08;
    case "buried":
      return low - FLOOR_HEIGHT - 0.6;
    case "floating":
      return low + 9;
    default:
      return low;
  }
}

/** Puerta de las casas que se pueden entrar. */
export const DOOR = { width: 1.3, height: 2.3 };
export const WALL = 0.2;

/** Paredes de una casa que se puede entrar, como cajas en su espacio local (centro y tamaño). */
export function enterableWalls(house: House): { center: [number, number, number]; size: [number, number, number] }[] {
  const { width: w, depth: d } = house;
  const H = house.floors * FLOOR_HEIGHT;
  const y = (H - HOUSE_SINK) / 2;
  const h = H + HOUSE_SINK;
  const side = (w - DOOR.width) / 2;
  return [
    { center: [0, y, -d / 2 + WALL / 2], size: [w, h, WALL] },
    { center: [-w / 2 + WALL / 2, y, 0], size: [WALL, h, d] },
    { center: [w / 2 - WALL / 2, y, 0], size: [WALL, h, d] },
    { center: [-(DOOR.width / 2 + side / 2), y, d / 2 - WALL / 2], size: [side, h, WALL] },
    { center: [DOOR.width / 2 + side / 2, y, d / 2 - WALL / 2], size: [side, h, WALL] },
    { center: [0, (DOOR.height + H) / 2, d / 2 - WALL / 2], size: [DOOR.width, H - DOOR.height, WALL] },
  ];
}

/** Casas que se pueden entrar, con su piso, para la altura del suelo del jugador. */
const ENTERABLE = HOUSES.filter((h) => h.kind === "enterable").map((h) => {
  const swap = Math.abs(Math.sin(h.rotation)) > 0.5;
  const halfX = (swap ? h.depth : h.width) / 2;
  const halfZ = (swap ? h.width : h.depth) / 2;
  return { house: h, floor: houseBase(h), halfX, halfZ };
});

// --- Rarezas del prado (Oddities.tsx). El frente de cada una mira a +Z local. ---

/** Cartel pintado a mano frente al punto de aparición, mirándolo. */
export const SANTIAGO_SIGN = { x: 6.5, z: -0.75, rotation: -0.11 };
/** Una sala de estar en medio del pasto: alfombra, sofá, mesita, lámpara y una tele con estática. */
export const LIVING_ROOM = { x: -14, z: 14, rotation: 0 };
/** Columpios que se mecen solos (el travesaño va a lo largo de X local). */
export const SWINGS = { x: 36, z: 18, rotation: 0.5 };
/** Máquina expendedora encendida, sola, mirando al punto de aparición. */
export const VENDING = { x: -5, z: -5, rotation: 0.885 };
/** Un teléfono público que suena cuando alguien se acerca. */
export const PAYPHONE = { x: 44, z: 2, rotation: -1.52 };
/** Una piscina de agua quieta en medio del prado, con su escalera. */
export const POOL = { x: -22, z: 30, rotation: 0, width: 5, length: 3 };
/** Un letrero de SALIDA encendido que no lleva a ningún lado. */
export const EXIT_SIGN = { x: -28, z: 8, rotation: 1.69 };

/** Donde no crece pasto aparte de las casas: la alfombra de la sala y la piscina (sin giro). */
const BARE_PATCHES = [
  { x: LIVING_ROOM.x, z: LIVING_ROOM.z, halfX: 1.65, halfZ: 1.45 },
  { x: POOL.x, z: POOL.z, halfX: POOL.width / 2 + 0.3, halfZ: POOL.length / 2 + 0.3 },
];
const GRASSLESS = ENTERABLE.length + BARE_PATCHES.length;

/** GLSL: insideRoom(vec2 xz), 1 dentro de una casa que se puede entrar o de un parche sin pasto. */
export const ROOMS_GLSL = /* glsl */ `
  uniform vec4 uRooms[${GRASSLESS}]; // x, z, medio ancho en X, medio ancho en Z
  float insideRoom(vec2 p) {
    float inside = 0.0;
    for (int i = 0; i < ${GRASSLESS}; i++) {
      vec2 d = abs(p - uRooms[i].xy) - uRooms[i].zw;
      inside = max(inside, step(max(d.x, d.y), 0.05));
    }
    return inside;
  }
`;

export const roomUniforms = () => ({
  uRooms: {
    value: [
      ...ENTERABLE.map((e) => new THREE.Vector4(e.house.x, e.house.z, e.halfX, e.halfZ)),
      ...BARE_PATCHES.map((b) => new THREE.Vector4(b.x, b.z, b.halfX, b.halfZ)),
    ],
  },
});

/** Altura del piso si (x, z) está dentro de una casa que se puede entrar; si no, null. */
export function interiorFloor(x: number, z: number): number | null {
  for (const e of ENTERABLE) {
    if (Math.abs(x - e.house.x) <= e.halfX && Math.abs(z - e.house.z) <= e.halfZ) return e.floor;
  }
  return null;
}

// --- Rarezas sueltas en el prado ---

/**
 * Una puerta sola, de pie en medio del prado, abierta. Es la salida de los Backrooms: al
 * cruzar su puerta se sale por esta (mira a +Z, como la del interior: el portal es una traslación).
 */
export const LONE_DOOR = { x: -20, z: -22, rotation: 0 };
/** Giro de la hoja abierta (sobre la bisagra izquierda, hacia afuera). */
export const LONE_DOOR_SWING = -2.2;
/** Una escalera que sube y termina en el aire (sube hacia +Z local). Se puede subir. */
export const STAIRS = { x: -55, z: -20, rotation: -0.9, steps: 12, rise: 0.26, run: 0.32, width: 1.4 };

/** Altura del peldaño de la escalera del prado bajo (x, z); null si no está sobre ella. */
export function stairsHeight(x: number, z: number): number | null {
  const dx = x - STAIRS.x;
  const dz = z - STAIRS.z;
  const c = Math.cos(STAIRS.rotation);
  const s = Math.sin(STAIRS.rotation);
  // Al espacio local de la escalera (inversa del giro en Y).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  if (Math.abs(lx) > STAIRS.width / 2) return null;
  const i = Math.floor(lz / STAIRS.run + STAIRS.steps / 2 + 0.5);
  if (i < 0 || i >= STAIRS.steps) return null;
  return terrainHeight(STAIRS.x, STAIRS.z) + (i + 1) * STAIRS.rise;
}

// --- Cercas ---

/** Tramos rectos de cerca blanca (desde, hasta). */
export const FENCES: [[number, number], [number, number]][] = [
  // Frente a la casa amarilla, con un hueco a modo de portón.
  [[10, -13.5], [16.6, -13.5]],
  [[19.4, -13.5], [26, -13.5]],
  [[-44, 17], [-56, 1]],
  [[63, -6], [74, -21]],
  [[22, 40], [40, 40]],
  [[-12, -30], [-24, -40]],
  // Una cerca en círculo que no encierra nada.
  ...Array.from({ length: 14 }, (_, i): [[number, number], [number, number]] => {
    const a0 = (i / 14) * Math.PI * 2;
    const a1 = ((i + 1) / 14) * Math.PI * 2;
    const [cx, cz, r] = [50, -24, 3.2];
    return [
      [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r],
      [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r],
    ];
  }),
];

export const PICKET_SPACING = 0.2;

// --- Faroles (se encienden de noche) ---

/** Faroles a los lados del sendero (alternados) y algunos junto a las casas. */
export const LAMPS: [number, number][] = [
  ...Array.from({ length: 5 }, (_, i): [number, number] => {
    const t = (i + 0.5) / 5;
    const [ax, az] = PATH.from;
    const [bx, bz] = PATH.to;
    const len = Math.hypot(bx - ax, bz - az);
    const side = i % 2 === 0 ? 1.6 : -1.6;
    // Perpendicular al sendero.
    return [ax + (bx - ax) * t + (-(bz - az) / len) * side, az + (bz - az) * t + ((bx - ax) / len) * side];
  }),
  [14, -12],
  [-42, 13],
  [26, 43],
  [65, -3],
  [-36, 37],
  [57, 27],
];

/** GLSL: lampGlow(vec2 xz), luz cálida de los faroles sobre el pasto (0 de día). */
export const LAMPS_GLSL = /* glsl */ `
  uniform vec2 uLamps[${LAMPS.length}];
  uniform float uLampGlow;
  float lampGlow(vec2 p) {
    float g = 0.0;
    for (int i = 0; i < ${LAMPS.length}; i++) {
      vec2 d = p - uLamps[i];
      float r2 = dot(d, d);
      // Charco amplio y suave + un núcleo tenue al pie del poste: sin borde marcado.
      g += exp(-r2 * 0.028) * 0.7 + 0.3 / (1.0 + r2 * 0.35);
    }
    return g * uLampGlow;
  }
`;

export const lampUniforms = () => ({
  uLamps: { value: LAMPS.map(([x, z]) => new THREE.Vector2(x, z)) },
  uLampGlow: { value: 0 },
});

// --- Colisiones ---

/** Un punto local (lx, lz) de una rareza, en coordenadas del mundo. */
function oddityPoint(o: { x: number; z: number; rotation: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  return [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
}

/** Colisiones de las rarezas (la piscina no choca: se puede caminar sobre el agua). */
function oddityColliders(): Collider[] {
  const boxAt = (o: typeof SANTIAGO_SIGN, lx: number, lz: number, w: number, d: number) => {
    const [x, z] = oddityPoint(o, lx, lz);
    return colliderFor([x, 0, z], o.rotation, w, d);
  };
  const circleAt = (o: typeof SANTIAGO_SIGN, lx: number, lz: number, r: number) => {
    const [x, z] = oddityPoint(o, lx, lz);
    return circleCollider(x, z, r);
  };
  return [
    boxAt(SANTIAGO_SIGN, 0, 0, 2, 0.3),
    boxAt(LIVING_ROOM, 0, 1.2, 2.1, 0.9), // sofá
    boxAt(LIVING_ROOM, 0, -1.3, 1.4, 0.55), // mueble de la tele
    circleAt(LIVING_ROOM, 1.3, 1.6, 0.2), // lámpara
    ...[-1.6, 1.6].flatMap((lx) => [-0.8, 0.8].map((lz) => circleAt(SWINGS, lx, lz, 0.1))),
    boxAt(VENDING, 0, 0, 1, 0.8),
    circleAt(PAYPHONE, 0, 0, 0.3),
    circleAt(EXIT_SIGN, 0, 0, 0.1),
  ];
}

export const LIMINAL_COLLIDERS: Collider[] = [
  circleCollider(TOWER.x, TOWER.z, 2.4),
  ...LAMPS.map(([x, z]) => circleCollider(x, z, 0.15)),
  // Las macizas: su planta. Las que se pueden entrar: cada pared por separado.
  ...HOUSES.filter((h) => h.kind !== "enterable" && h.kind !== "floating").map((h) =>
    colliderFor([h.x, 0, h.z], h.rotation, h.width, h.depth)
  ),
  ...HOUSES.filter((h) => h.kind === "enterable").flatMap((h) =>
    // Sin el dintel (el último): está sobre la puerta y no debe tapar el paso.
    enterableWalls(h).slice(0, 5).map(({ center: [cx, , cz], size: [sx, , sz] }) => {
      const c = Math.cos(h.rotation);
      const s = Math.sin(h.rotation);
      return colliderFor([h.x + cx * c + cz * s, 0, h.z - cx * s + cz * c], h.rotation, sx, sz);
    })
  ),
  // La puerta sola: solo sus jambas (por el hueco se sale de los Backrooms).
  ...[-1, 1].map((s) => circleCollider(LONE_DOOR.x + s * (DOOR.width / 2 + 0.075), LONE_DOOR.z, 0.04)),
  ...oddityColliders(),
  // La escalera no choca: sus peldaños son suelo (stairsHeight) y se suben caminando.
  ...holeColliders(),
  // La cerca: círculos pequeños cada medio metro a lo largo del tramo.
  ...FENCES.flatMap(([a, b]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(length / 0.5);
    return Array.from({ length: n + 1 }, (_, i) =>
      circleCollider(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0.12)
    );
  }),
];

// --- Cielo ---

/** Colores del cielo: cenit y horizonte (la neblina y el pasto lejano usan el horizonte). */
export const SKY = {
  day: { zenith: "#2f86e6", horizon: "#cfe6fa" },
  night: { zenith: "#02040b", horizon: "#0b1020" },
} as const;
