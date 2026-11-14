// ==========================================
// interiorMaps.ts - LAS CASAS QUE SON MÁS GRANDES POR DENTRO
// ==========================================
// Dos casas del prado se pueden entrar y por dentro son enormes: la amarilla lleva al
// "pasillo de la nube" (paredes blancas, alfombra verde, una nube gigante y una escalera
// que sube al cielo) y la de junto a "Sobre mí" a unas "Poolrooms" (azulejo blanco,
// techos altos y piscinas quietas).
//
// Los "Backrooms" (papel tapiz amarillo, alfombra, tubos fluorescentes) no tienen casa:
// se llega cayendo por el agujero (Player hace el fundido y el salto, NOCLIP) y se sale
// por su puerta, que da a la puerta sola del prado (solo de ida: oneWay).
//
// Portal:
// - Cada interior es un mapa de celdas de 1 m que vive lejos, bajo el mundo (x ≥ 300).
// - Su puerta (un hueco en la pared sur de un pasillo corto que dobla hacia la sala
//   grande, para que no se vea de frente lo que hay al otro lado) mide lo mismo que la de la
//   casa y mira hacia el mismo lado. Las dos puertas son "la misma": Portals.tsx dibuja
//   en cada hueco lo que se ve por el otro (desde afuera, la sala; desde adentro, el
//   prado) y al cruzar el umbral el jugador pasa al otro lado (portalCross). Como la
//   relación entre las dos puertas es una traslación, la vista sigue igual.
// - Los pasillos infinitos usan el mismo truco dentro del mapa: pasado cierto punto, el
//   jugador retrocede un periodo exacto del pasillo (luces y paredes se repiten igual).
//
// Aquí solo hay datos y lógica (sin React); Interiors.tsx y Portals.tsx los dibujan.

import * as THREE from "three";
import { colliderFor, type Collider } from "./shared";
import { DOOR, HOUSES, LONE_DOOR, houseBase, terrainHeight, type House, type InteriorKind } from "./liminal";

/** Desde aquí en X empiezan los interiores lejanos. */
export const REMOTE_X_MIN = 300;
export const CEILING = 2.7;
export const HIGH_CEILING = 6;
export const POOL_DEPTH = 0.4;
/** De los pies a la coronilla: la cabeza no puede pasar del techo. */
export const HEAD_HEIGHT = 1.8;

// --- Celdas ---
// '#' pared · '.' piso · 'o' piso con techo alto · 'P' piscina · 'Q' piscina con techo
// alto · 'D' puerta (piso) · 'v' vacío tras la puerta (sin geometría: ahí se ve el
// portal). Lo que no está en el mapa es pared.

const FLOORS = new Set([".", "o", "P", "Q", "D"]);
export const isFloor = (c: string | undefined) => c !== undefined && FLOORS.has(c);
export const isPool = (c: string | undefined) => c === "P" || c === "Q";
export const isVoid = (c: string | undefined) => c === "v";
export const ceilingOf = (c: string | undefined) => (c === "o" || c === "Q" ? HIGH_CEILING : CEILING);

export interface Light {
  x: number;
  z: number;
  /** Altura del panel (el techo de su celda). */
  y: number;
  flicker: boolean;
}

export type PropKind =
  | "paintedDoor"
  | "tinyDoor"
  | "chair"
  | "ceilingTable"
  | "stairsUp"
  | "skyWindow"
  | "doorFrame"
  // Pasillo de la nube.
  | "cloud"
  | "skyOpening"
  | "dresser"
  | "painting"
  | "sconce"
  | "darkDoorway"
  | "bed"
  | "ceilingDoor"
  | "floatingChair"
  | "skyHole"
  | "clock"
  | "upsideDownPainting";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** Giro en Y: el frente del objeto mira hacia +Z local. */
  rotation: number;
  /** Solo las nubes: altura de su centro y radios (x, y, z). Se atraviesan (Clouds.tsx). */
  cloud?: { y: number; radii: [number, number, number] };
}

export interface Loop {
  /** Columnas (en celdas) donde rige el bucle. */
  x0: number;
  x1: number;
  /** Pasado este Z (hacia +Z), se retrocede `period` celdas. */
  trigger: number;
  period: number;
}

export interface Palette {
  wall: string;
  floor: string;
  ceiling: string;
  /** Multiplicador de todo de noche. */
  night: string;
  panelDay: string;
  fog: { day: string; night: string; near: number; far: number };
}

export interface Level {
  kind: InteriorKind;
  /** La casa por la que se entra (los Backrooms no tienen: se llega cayendo al agujero). */
  house?: House;
  /** Solo se sale por su puerta (no se entra por la del prado). */
  oneWay: boolean;
  cells: Map<string, string>;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  lights: Light[];
  props: Prop[];
  /** Puerta en el mapa: centro del hueco en X y fila de la pared (el umbral es z + 1). */
  door: { x: number; z: number };
  loop: Loop;
  palette: Palette;
  /** Mundo: dónde queda la celda (0, 0) del mapa lejano. */
  remote: THREE.Vector3;
  /** Mundo: centro del umbral de la casa real (pie de la puerta, cara exterior). */
  realDoor: THREE.Vector3;
  /** Mundo: centro del umbral de la puerta del interior. */
  remoteDoor: THREE.Vector3;
  /**
   * El portal (donde se cruza), de cada lado: centro del plano al pie. En las casas está en
   * medio del pasillo de entrada, cruzándolo de pared a pared (eje X: se entra hacia -X);
   * el tramo desde la puerta hasta ahí existe igual dentro de la casa real (replica), así al
   * cruzar no cambia nada a la vista y al prado se sale por la puerta de verdad.
   * En los Backrooms (sin casa) está en el umbral de la puerta (eje Z).
   */
  realPortal: THREE.Vector3;
  remotePortal: THREE.Vector3;
  portalAxis: "x" | "z";
  /** Medio ancho y alto del plano del portal. */
  portalHalf: number;
  portalHeight: number;
  /** Celdas del mapa que se copian dentro de la casa real (con una columna más allá del portal). */
  replica?: { x0: number; x1: number; z0: number; z1: number };
}

/** Portal en el pasillo de entrada: x de la cara donde se cruza y filas del pasillo (z0 a z1, sin incluir). */
interface PortalSpot {
  x: number;
  z0: number;
  z1: number;
}

/** Generador de mapas: se tallan rectángulos sobre la pared. */
class Grid {
  cells = new Map<string, string>();
  lights: Light[] = [];
  props: Prop[] = [];
  door = { x: 0, z: 0 };
  portal?: PortalSpot;
  carve(x0: number, z0: number, x1: number, z1: number, c = ".") {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.cells.set(`${x},${z}`, c);
  }
  wall(x: number, z: number) {
    this.cells.set(`${x},${z}`, "#");
  }
  /** Puerta de 2 celdas en la pared sur (fila z), con su centro en x: del otro lado, vacío. */
  entrance(x: number, z: number) {
    this.carve(x - 1, z, x, z, "D");
    this.carve(x - 2, z + 1, x + 1, z + 1, "v");
    this.door = { x, z };
  }
  light(x: number, z: number, flicker = false) {
    const c = this.cells.get(`${Math.floor(x)},${Math.floor(z)}`);
    this.lights.push({ x, z, y: ceilingOf(c), flicker });
  }
  /** Luces en cuadrícula sobre las celdas de piso de un rectángulo. */
  lightGrid(x0: number, z0: number, x1: number, z1: number, step: number, rand: () => number, flickerChance = 0) {
    for (let x = x0; x <= x1; x += step) {
      for (let z = z0; z <= z1; z += step) {
        if (isFloor(this.cells.get(`${x},${z}`))) this.light(x + 0.5, z + 0.5, rand() < flickerChance);
      }
    }
  }
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// --- Backrooms (casa amarilla) ---

function backrooms(): Grid {
  const g = new Grid();
  const rand = seeded(1337);
  // Sala de pilares.
  g.carve(8, 1, 20, 13);
  for (const x of [11, 15, 19]) for (const z of [4, 8, 12]) g.wall(x, z);
  // Entrada con vuelta: de la puerta se sube 2 m, se dobla al oeste por un pasillo y se
  // entra a la sala. Ni desde la sala se ve la puerta ni desde la puerta la sala.
  g.carve(17, 14, 18, 14);
  g.carve(17, 15, 26, 16);
  g.entrance(25, 17);
  // Cuarto de puertas pintadas (al oeste), con una puerta diminuta.
  g.carve(7, 6, 7, 7);
  g.carve(2, 4, 6, 9);
  // Pasillo infinito hacia el sur, desde el cuarto de puertas.
  g.carve(3, 10, 4, 76);
  // Pasillo al sur de la sala de pilares y el cuarto con los muebles en el techo.
  g.carve(14, 14, 15, 19);
  g.carve(10, 20, 22, 25);
  // Pasillos largos al este y un cuarto vacío con una silla mirando a la esquina.
  g.carve(21, 2, 28, 2);
  g.carve(28, 3, 28, 9);
  g.carve(21, 10, 31, 10);
  g.carve(31, 11, 31, 17);
  g.carve(28, 18, 34, 26);
  g.carve(23, 23, 27, 23);

  g.lightGrid(9, 2, 20, 13, 3, rand, 0.2);
  g.light(9.5, 12.5);
  g.light(18, 15.5);
  g.light(23.5, 16, true);
  g.lightGrid(3, 5, 6, 9, 3, rand, 0.5);
  g.light(14.5, 16.5, true);
  g.lightGrid(11, 21, 22, 25, 3, rand, 0.15);
  g.light(23.5, 2.5);
  g.light(28.5, 5.5, true);
  g.light(24.5, 10.5);
  g.light(28.5, 10.5, true);
  g.light(31.5, 14.5);
  g.lightGrid(29, 19, 34, 26, 3, rand, 0.3);
  // Pasillo infinito: una luz cada 4 celdas (el periodo del bucle es 8, así se repite igual).
  for (let z = 12; z <= 76; z += 4) g.light(4, z + 0.5, z % 8 === 0);

  g.props.push(
    { kind: "paintedDoor", x: 2, z: 6.5, rotation: Math.PI / 2 },
    { kind: "paintedDoor", x: 4.5, z: 4, rotation: 0 },
    { kind: "tinyDoor", x: 7, z: 8.6, rotation: -Math.PI / 2 },
    { kind: "ceilingTable", x: 16, z: 22.5, rotation: 0.3 },
    { kind: "chair", x: 33.4, z: 25.4, rotation: Math.PI * 0.75 },
    { kind: "paintedDoor", x: 23, z: 21.5, rotation: -Math.PI / 2 }
  );
  return g;
}

// --- Poolrooms (casa de "Sobre mí") ---

function poolrooms(): Grid {
  const g = new Grid();
  const rand = seeded(4040);
  // Gran sala de techo alto con una piscina en el centro.
  g.carve(6, 1, 20, 14, "o");
  g.carve(9, 4, 17, 11, "Q");
  // Entrada con vuelta, como en los Backrooms: pasillo bajo que dobla hacia la sala.
  g.carve(18, 15, 19, 15);
  g.carve(18, 16, 26, 17);
  g.entrance(25, 18);
  g.portal = { x: 22, z0: 16, z1: 18 };
  // Sala baja inundada al este.
  g.carve(21, 6, 28, 12, "P");
  // Cuarto de puertas al oeste.
  g.carve(5, 8, 5, 8);
  g.carve(1, 6, 4, 10);
  // Pasillo inundado infinito hacia el sur.
  g.carve(12, 15, 13, 84, "P");

  g.lightGrid(7, 2, 20, 14, 4, rand);
  g.light(19, 16.5);
  g.light(23.5, 17);
  g.lightGrid(22, 7, 28, 12, 3, rand, 0.2);
  g.lightGrid(2, 7, 4, 10, 2, rand, 0.4);
  for (let z = 16; z <= 82; z += 4) g.light(13, z + 0.5, z % 8 === 0);

  g.props.push(
    { kind: "stairsUp", x: 7.5, z: 1, rotation: 0 },
    { kind: "skyWindow", x: 6, z: 9.5, rotation: Math.PI / 2 },
    { kind: "doorFrame", x: 13, z: 7.5, rotation: 0.4 },
    { kind: "paintedDoor", x: 1, z: 8, rotation: Math.PI / 2 },
    { kind: "paintedDoor", x: 2.5, z: 6, rotation: 0 },
    { kind: "tinyDoor", x: 3, z: 11, rotation: Math.PI },
    { kind: "doorFrame", x: 26, z: 9, rotation: -0.7 }
  );
  return g;
}

// --- Pasillo de la nube (casa amarilla) ---

function cloudhall(): Grid {
  const g = new Grid();
  // Pasillo largo hacia el norte; al fondo, techo alto con la escalera que sube al cielo.
  g.carve(6, 8, 8, 24);
  g.carve(6, 2, 8, 7, "o");
  // Entrada con vuelta: de la puerta se sube y se dobla al oeste hacia el pasillo.
  g.carve(6, 25, 12, 26);
  g.entrance(12, 27);
  // El portal, en medio del pasillo de entrada (entre la puerta y el pasillo largo).
  g.portal = { x: 9, z0: 25, z1: 27 };
  // Un cuarto vacío al este y, al oeste, un pasillo que no termina.
  g.carve(9, 14, 9, 14);
  g.carve(10, 12, 14, 16);
  g.carve(5, 12, 5, 12);
  g.carve(3, 10, 4, 100);

  // Luces de techo redondas.
  for (let z = 9; z <= 24; z += 3) g.light(7.5, z + 0.5);
  g.light(7.5, 3.5);
  g.light(7.5, 6.5);
  g.light(9, 25.5);
  g.light(12, 15, true);
  for (let z = 12; z <= 100; z += 4) g.light(4, z + 0.5, z % 8 === 0);

  g.props.push(
    { kind: "stairsUp", x: 6, z: 7.9, rotation: Math.PI / 2 },
    { kind: "skyOpening", x: 7.5, z: 2, rotation: 0 },
    // Nubes: la grande delante de la escalera y otras sueltas por la casa (se atraviesan).
    { kind: "cloud", x: 8.1, z: 6.2, rotation: 0, cloud: { y: 1.55, radii: [0.9, 1.6, 1.4] } },
    { kind: "cloud", x: 7.2, z: 3.4, rotation: 0, cloud: { y: 4.9, radii: [1.3, 0.6, 1.0] } },
    { kind: "cloud", x: 7.4, z: 12.5, rotation: 0, cloud: { y: 2.2, radii: [1.1, 0.42, 1.9] } },
    { kind: "cloud", x: 6.9, z: 22.6, rotation: 0, cloud: { y: 0.9, radii: [0.85, 0.8, 1.1] } },
    { kind: "cloud", x: 12.2, z: 14.4, rotation: 0, cloud: { y: 1.3, radii: [1.7, 1.1, 1.6] } },
    // (Del lado del pasillo largo, pasado el portal: la copia del pasillo de entrada no tiene nubes.)
    { kind: "cloud", x: 7.3, z: 25.7, rotation: 0, cloud: { y: 2.15, radii: [1.2, 0.42, 0.7] } },
    { kind: "cloud", x: 3.9, z: 16.5, rotation: 0, cloud: { y: 1.6, radii: [0.75, 1.15, 1.5] } },
    { kind: "dresser", x: 8.72, z: 17, rotation: -Math.PI / 2 },
    { kind: "painting", x: 8.98, z: 19.5, rotation: -Math.PI / 2 },
    { kind: "darkDoorway", x: 8.98, z: 21.8, rotation: -Math.PI / 2 },
    { kind: "darkDoorway", x: 6.02, z: 18, rotation: Math.PI / 2 },
    { kind: "sconce", x: 6.02, z: 10, rotation: Math.PI / 2 },
    { kind: "sconce", x: 6.02, z: 15, rotation: Math.PI / 2 },
    { kind: "sconce", x: 6.02, z: 21, rotation: Math.PI / 2 },
    { kind: "sconce", x: 8.98, z: 11, rotation: -Math.PI / 2 },
    // Rarezas: una silla mirando un reloj sin agujas, una cama bajo la nube del cuarto, una
    // puerta en el techo, una silla flotando, un charco de cielo en la alfombra, un cuadro
    // colgado al revés y una puerta diminuta en el zócalo.
    { kind: "chair", x: 13.6, z: 12.7, rotation: Math.PI / 2 },
    { kind: "clock", x: 14.78, z: 12.6, rotation: -Math.PI / 2 },
    { kind: "bed", x: 11.3, z: 15.9, rotation: Math.PI / 2 },
    { kind: "ceilingDoor", x: 7.5, z: 15.6, rotation: 0.2 },
    { kind: "floatingChair", x: 6.9, z: 19.8, rotation: 0.7 },
    { kind: "skyHole", x: 7.7, z: 23.3, rotation: 0.4 },
    { kind: "upsideDownPainting", x: 6.02, z: 12.6, rotation: Math.PI / 2 },
    { kind: "tinyDoor", x: 8.98, z: 23.6, rotation: -Math.PI / 2 }
  );
  return g;
}

const PALETTES: Record<InteriorKind, Palette> = {
  cloudhall: {
    wall: "#ebe6d8",
    floor: "#1f6e54",
    ceiling: "#f2efe7",
    night: "#7f8aa8",
    panelDay: "#fff4dc",
    fog: { day: "#d9d4c4", night: "#151b26", near: 6, far: 30 },
  },
  backrooms: {
    wall: "#cdb95f",
    floor: "#8e7f4b",
    ceiling: "#d9d3ad",
    night: "#7c88a8",
    panelDay: "#fffbe6",
    fog: { day: "#a0955c", night: "#161c27", near: 4, far: 22 },
  },
  poolrooms: {
    wall: "#eef3f2",
    floor: "#e9f0f0",
    ceiling: "#f4f7f6",
    night: "#8197b2",
    panelDay: "#f3fbff",
    fog: { day: "#c4dbe0", night: "#1b2c3a", near: 5, far: 26 },
  },
};

const LOOPS: Record<InteriorKind, Loop> = {
  backrooms: { x0: 3, x1: 4, trigger: 48, period: 8 },
  poolrooms: { x0: 12, x1: 13, trigger: 53, period: 8 },
  // El disparador queda lejos del pasillo principal (la prueba exige que alrededor se repita igual).
  cloudhall: { x0: 3, x1: 4, trigger: 64, period: 8 },
};

const BUILDERS: Record<InteriorKind, () => Grid> = { backrooms, poolrooms, cloudhall };
const REMOTE_ORIGIN: Record<InteriorKind, [number, number, number]> = {
  backrooms: [400, -50, -40],
  poolrooms: [600, -50, -40],
  cloudhall: [800, -50, -40],
};

/** Por dónde se sale de cada interior al prado: la puerta de su casa o, en los Backrooms, la puerta sola. */
function exitDoor(house?: House) {
  if (house) return new THREE.Vector3(house.x, houseBase(house), house.z + house.depth / 2);
  return new THREE.Vector3(LONE_DOOR.x, terrainHeight(LONE_DOOR.x, LONE_DOOR.z), LONE_DOOR.z);
}

function makeLevel(kind: InteriorKind, house?: House): Level {
  const g = BUILDERS[kind]();
  const keys = [...g.cells.keys()].map((k) => k.split(",").map(Number));
  const remote = new THREE.Vector3(...REMOTE_ORIGIN[kind]);
  const realDoor = exitDoor(house);
  const remoteDoor = new THREE.Vector3(remote.x + g.door.x, remote.y, remote.z + g.door.z + 1);
  const spot = house ? g.portal : undefined;
  const remotePortal = spot ? new THREE.Vector3(remote.x + spot.x, remote.y, remote.z + (spot.z0 + spot.z1) / 2) : remoteDoor.clone();
  return {
    remotePortal,
    realPortal: remotePortal.clone().sub(remoteDoor).add(realDoor),
    portalAxis: spot ? "x" : "z",
    portalHalf: spot ? (spot.z1 - spot.z0) / 2 : DOOR.width / 2,
    portalHeight: spot ? CEILING : DOOR.height,
    // Del portal (más una columna) a la pared este de la puerta, y de la pared norte del pasillo a la fila de la puerta.
    replica: spot ? { x0: spot.x - 1, x1: g.door.x + 1, z0: spot.z0 - 1, z1: g.door.z } : undefined,
    kind,
    house,
    oneWay: !house,
    cells: g.cells,
    minX: Math.min(...keys.map((k) => k[0])) - 1,
    maxX: Math.max(...keys.map((k) => k[0])) + 1,
    minZ: Math.min(...keys.map((k) => k[1])) - 1,
    maxZ: Math.max(...keys.map((k) => k[1])) + 1,
    lights: g.lights,
    props: g.props,
    door: g.door,
    loop: LOOPS[kind],
    palette: PALETTES[kind],
    remote,
    // La cara exterior de la puerta de salida (giro 0: mira a +Z).
    realDoor,
    remoteDoor,
  };
}

export const LEVELS: Level[] = [
  ...HOUSES.filter((h) => h.kind === "enterable" && h.interior).map((h) => makeLevel(h.interior!, h)),
  makeLevel("backrooms"),
];

/**
 * Caída por el agujero a los Backrooms: pasado `fadeFrom` se funde a negro y al llegar a
 * `teleportAt` el jugador aparece en la sala de pilares (un poco en el aire), mirando al norte.
 */
export const NOCLIP = (() => {
  const level = LEVELS.find((l) => l.kind === "backrooms")!;
  return {
    fadeFrom: -18,
    teleportAt: -58,
    to: level.remote.clone().add(new THREE.Vector3(13.5, 0, 6.5)),
    look: level.remote.clone().add(new THREE.Vector3(13.5, 0, 0)),
  };
})();

export const cellAt = (level: Level, x: number, z: number) => level.cells.get(`${x},${z}`);

/** Desplazamiento de la puerta de la casa a la del interior. */
export const portalOffset = (level: Level) => level.remoteDoor.clone().sub(level.realDoor);

/** Interior lejano en el que está (x, z), si lo hay. */
function remoteLevelAt(x: number, z: number) {
  if (x < REMOTE_X_MIN) return undefined;
  return LEVELS.find(
    (l) => x >= l.remote.x + l.minX && x <= l.remote.x + l.maxX + 1 && z >= l.remote.z + l.minZ && z <= l.remote.z + l.maxZ + 1
  );
}

/**
 * Si al ir de `from` a `to` se cruzó un portal, cuánto mover al jugador (a la cámara y a
 * los pies por igual). Hacia adentro (hacia -X en el pasillo de entrada de las casas, -Z
 * en la puerta de los Backrooms) se pasa al interior; hacia afuera, en el mismo punto del
 * interior, se vuelve (a la copia del pasillo en la casa, o a la puerta sola del prado).
 */
export function portalCross(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 | null {
  for (const l of LEVELS) {
    const a = l.portalAxis;
    const b = a === "x" ? "z" : "x";
    const within = (p: THREE.Vector3) => Math.abs(to[b] - p[b]) < l.portalHalf && Math.abs(to.y - p.y) < 4;
    const real = l.realPortal;
    if (!l.oneWay && from[a] >= real[a] && to[a] < real[a] && within(real)) return portalOffset(l);
    const remote = l.remotePortal;
    if (from[a] <= remote[a] && to[a] > remote[a] && within(remote)) return portalOffset(l).negate();
  }
  return null;
}

/** Pasillos infinitos: pasado el disparador, se retrocede un periodo exacto. */
export function loopShift(p: THREE.Vector3): THREE.Vector3 | null {
  const level = remoteLevelAt(p.x, p.z);
  if (!level) return null;
  const { x0, x1, trigger, period } = level.loop;
  const cx = Math.floor(p.x - level.remote.x);
  if (cx >= x0 && cx <= x1 && p.z - level.remote.z > trigger) return new THREE.Vector3(0, 0, -period);
  return null;
}

/** Escalera que sube hacia +X local y se mete en el techo (prop "stairsUp"). */
export const STAIRS_UP = { steps: 16, run: 0.32, width: 1.2 };
/** Alto de cada peldaño: el último queda 0,4 m dentro del techo. */
export const stairsUpRise = (ceiling: number) => (ceiling + 0.4) / STAIRS_UP.steps;

/** Altura del peldaño (sobre el piso del mapa) si (mx, mz) del mapa está sobre una escalera. */
function stairsUpAt(level: Level, mx: number, mz: number): number | null {
  for (const p of level.props) {
    if (p.kind !== "stairsUp") continue;
    const dx = mx - p.x;
    const dz = mz - p.z;
    const c = Math.cos(p.rotation);
    const s = Math.sin(p.rotation);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (lz < 0 || lz > STAIRS_UP.width || lx < 0) continue;
    const i = Math.floor(lx / STAIRS_UP.run);
    if (i >= STAIRS_UP.steps) continue;
    const cell = cellAt(level, Math.floor(p.x), Math.floor(p.z));
    return (isPool(cell) ? -POOL_DEPTH : 0) + (i + 1) * stairsUpRise(ceilingOf(cell));
  }
  return null;
}

/** Altura del piso en un interior lejano (null si (x, z) no está en uno). */
export function interiorGround(x: number, z: number): number | null {
  const level = remoteLevelAt(x, z);
  if (!level) return null;
  const mx = x - level.remote.x;
  const mz = z - level.remote.z;
  const stairs = stairsUpAt(level, mx, mz);
  if (stairs !== null) return level.remote.y + stairs;
  const c = cellAt(level, Math.floor(mx), Math.floor(mz));
  return level.remote.y - (isPool(c) ? POOL_DEPTH : 0);
}

/** Altura del techo en un interior lejano (null afuera): de ahí no pasa la cabeza. */
export function interiorCeiling(x: number, z: number): number | null {
  const level = remoteLevelAt(x, z);
  if (!level) return null;
  const c = cellAt(level, Math.floor(x - level.remote.x), Math.floor(z - level.remote.z));
  return level.remote.y + (isFloor(c) ? ceilingOf(c) : CEILING);
}

/** Interior lejano donde está la cámara (para su neblina). */
export const indoorAt = (x: number, z: number): Level | undefined => remoteLevelAt(x, z);

/** Neblina de afuera de este frame (la escribe ThemeSky; la usa el portal que mira al prado). */
export const OUTDOOR_FOG = { near: 60, far: 260, color: new THREE.Color() };

// --- Colisiones: paredes unidas en tramos por fila ---

/** Paredes del mapa (o solo de una zona, para la copia del pasillo de entrada) con su origen en `origin`. */
function wallColliders(
  level: Level,
  origin = level.remote,
  area = { x0: level.minX, x1: level.maxX, z0: level.minZ, z1: level.maxZ }
): Collider[] {
  const out: Collider[] = [];
  const { x: ox, z: oz } = origin;
  const solid = (x: number, z: number) => {
    const c = cellAt(level, x, z);
    if (isFloor(c) || isVoid(c)) return false;
    // Solo importan las paredes junto a un piso (las demás no se alcanzan).
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (isFloor(cellAt(level, x + dx, z + dz))) return true;
    return false;
  };
  for (let z = area.z0; z <= area.z1; z++) {
    let start: number | null = null;
    for (let x = area.x0; x <= area.x1 + 1; x++) {
      const s = x <= area.x1 && solid(x, z);
      if (s && start === null) start = x;
      if (!s && start !== null) {
        out.push({ minX: ox + start, maxX: ox + x, minZ: oz + z, maxZ: oz + z + 1 });
        start = null;
      }
    }
  }
  return out;
}

/** Jambas de la puerta del interior: dejan un hueco del ancho de la puerta de la casa. */
export function doorJambs(level: Level) {
  const half = DOOR.width / 2;
  const { x, z } = level.door;
  return [
    { minX: x - 1, maxX: x - half },
    { minX: x + half, maxX: x + 1 },
  ].map((j) => ({ ...j, minZ: z, maxZ: z + 1 }));
}

/** Cajas de colisión de los objetos que se interponen (marcos, sillas). Las escaleras se suben: no chocan. */
function propColliders(level: Level): Collider[] {
  return level.props.flatMap((p) => {
    const x = level.remote.x + p.x;
    const z = level.remote.z + p.z;
    switch (p.kind) {
      case "doorFrame":
        return [{ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.3, maxZ: z + 0.3 }];
      case "chair":
        return [{ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 }];
      case "dresser":
        return [{ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.6, maxZ: z + 0.6 }];
      case "bed":
        return [colliderFor([x, 0, z], p.rotation, 1.4, 2.1)];
      case "clock":
        return [colliderFor([x, 0, z], p.rotation, 0.5, 0.35)];
      case "floatingChair":
        return [colliderFor([x, 0, z], p.rotation, 0.6, 0.6)];
      default:
        return [];
    }
  });
}

/** Dónde queda la celda (0, 0) del mapa en la copia del pasillo de entrada dentro de la casa real. */
export const replicaOrigin = (level: Level) => level.remote.clone().sub(portalOffset(level));

export const INTERIOR_COLLIDERS: Collider[] = LEVELS.flatMap((level) => {
  const jambs = (o: THREE.Vector3) => doorJambs(level).map((j) => ({ minX: o.x + j.minX, maxX: o.x + j.maxX, minZ: o.z + j.minZ, maxZ: o.z + j.maxZ }));
  return [
    ...wallColliders(level),
    ...propColliders(level),
    ...jambs(level.remote),
    // Las mismas paredes y jambas en la copia del pasillo de entrada dentro de la casa real.
    ...(level.replica ? [...wallColliders(level, replicaOrigin(level), level.replica), ...jambs(replicaOrigin(level))] : []),
  ];
});
