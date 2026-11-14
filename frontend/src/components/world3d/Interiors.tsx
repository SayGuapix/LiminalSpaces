// ==========================================
// Interiors.tsx - DIBUJO DE LOS INTERIORES (BACKROOMS, POOLROOMS Y PASILLO DE LA NUBE)
// ==========================================
// Cada interior (interiorMaps.ts) vive lejos, bajo el mundo. Desde la casa se lo ve
// por el portal de la puerta (Portals.tsx).
//
// Rendimiento:
// - Luz horneada: el brillo de cada vértice sale de la distancia a los tubos
//   fluorescentes, calculado una sola vez al cargar. Material básico, sin luces reales.
// - Texturas procedurales en el shader (interiorShaders.ts): papel tapiz, alfombra y
//   placas del techo en los Backrooms; azulejos, cáusticas y agua en las Poolrooms.
// - Pocas mallas por interior: paredes/pisos/techos, tubos fijos, tubos que parpadean,
//   agua y la ventana al cielo. El interior lejano queda fuera de la cámara (y no se
//   dibuja) mientras se está afuera.
//
// De día los tubos son blanco cálido; de noche todo se enfría y los que parpadean lo
// hacen más seguido.

import { useEffect, useMemo, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { at, box, painted } from "./geometryKit";
import { SURFACE, interiorTime, surfaceMaterial, waterMaterial } from "./interiorShaders";
import { DOOR, WALL } from "./liminal";
import Clouds from "./Clouds";
import {
  CEILING,
  LEVELS,
  doorJambs,
  POOL_DEPTH,
  STAIRS_UP,
  stairsUpRise,
  cellAt,
  ceilingOf,
  isFloor,
  isPool,
  isVoid,
  replicaOrigin,
  type Level,
  type Light,
  type Prop,
} from "./interiorMaps";

type BlendRef = MutableRefObject<number>;

const TRIM = "#f4f2ea";
const COLD_LIGHT = new THREE.Color("#cfe8ff");
const WHITE = new THREE.Color("#ffffff");

// --- Luz horneada ---

const SIGMA2 = 2 * 2.4 * 2.4;

/** Multiplica el color de cada vértice por la luz de los tubos cercanos y la orientación de la cara. */
function bake(geometry: THREE.BufferGeometry, lights: Light[]) {
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const color = geometry.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let light = 0.42;
    for (const l of lights) {
      const dx = x - l.x;
      const dz = z - l.z;
      if (dx > 8 || dx < -8 || dz > 8 || dz < -8) continue;
      const dy = (y - l.y) * 0.6;
      light += 0.75 * Math.exp(-(dx * dx + dz * dz + dy * dy) / SIGMA2);
    }
    light = Math.min(light, 1.2);
    let face = 1;
    if (normal) {
      const ny = normal.getY(i);
      const nx = Math.abs(normal.getX(i));
      face = ny > 0.5 ? 1 : ny < -0.5 ? 0.9 : nx > 0.5 ? 0.86 : 0.78;
      // Las paredes se oscurecen un poco hacia el piso.
      if (Math.abs(ny) < 0.5) face *= 0.8 + 0.2 * THREE.MathUtils.smoothstep(y, 0, 2.4);
    }
    const k = light * face;
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
  }
  return geometry;
}

/** Solo posición y color: así todas las piezas se pueden unir. */
function strip(geometry: THREE.BufferGeometry) {
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  return geometry;
}

/** Marca el tipo de superficie de cada vértice (elige la textura en el shader). */
function tag(geometry: THREE.BufferGeometry, surface: number) {
  geometry.setAttribute("surface", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(surface), 1));
  return geometry;
}

// --- Objetos raros ---

/** Puerta pintada contra la pared (frente hacia +Z local); scale < 1 para la diminuta. */
function doorParts(scale: number) {
  const s = scale;
  return [
    painted(box(1.15 * s, 2.25 * s, 0.03), TRIM, at(0, 1.12 * s, 0.015)),
    painted(box(0.95 * s, 2.05 * s, 0.05), "#6b5038", at(0, 1.03 * s, 0.03)),
    painted(new THREE.SphereGeometry(0.045 * s + 0.01, 8, 6), "#c9a95c", at(0.34 * s, 1.0 * s, 0.07)),
  ];
}

function chairParts() {
  return [
    painted(box(0.5, 0.06, 0.5), "#7a5a40", at(0, 0.48, 0)),
    painted(box(0.5, 0.55, 0.06), "#7a5a40", at(0, 0.78, -0.22)),
    ...[
      [-0.21, -0.21],
      [0.21, -0.21],
      [-0.21, 0.21],
      [0.21, 0.21],
    ].map(([x, z]) => painted(box(0.05, 0.46, 0.05), "#6a4c36", at(x, 0.23, z))),
  ];
}

function tableParts() {
  const parts = [painted(box(1.4, 0.06, 0.9), "#8a6a4a", at(0, 0.75, 0))];
  for (const [x, z] of [
    [-0.6, -0.36],
    [0.6, -0.36],
    [-0.6, 0.36],
    [0.6, 0.36],
  ])
    parts.push(painted(box(0.06, 0.72, 0.06), "#6f5338", at(x, 0.36, z)));
  // Cuatro sillas alrededor.
  [
    [0, -0.75, 0],
    [0, 0.75, Math.PI],
    [-1.0, 0, Math.PI / 2],
    [1.0, 0, -Math.PI / 2],
  ].forEach(([x, z, r]) => {
    const m = at(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(r));
    chairParts().forEach((g) => parts.push(g.applyMatrix4(m)));
  });
  return parts;
}

// --- Pasillo de la nube ---

/** Esfera blanca sombreada a mano (más gris abajo): las nubes pintadas del cielo, sin hornear. */
function puff(x: number, y: number, z: number, r: number, squash = 1) {
  const g = painted(new THREE.SphereGeometry(r, 16, 12), "#ffffff");
  g.scale(1, 1, squash);
  g.translate(x, y, z);
  const n = g.attributes.normal;
  const c = g.attributes.color;
  const shadow = new THREE.Color("#b7c1cd");
  const tmp = new THREE.Color();
  for (let i = 0; i < c.count; i++) {
    tmp.copy(shadow).lerp(WHITE, THREE.MathUtils.clamp(0.55 + 0.45 * n.getY(i) + 0.15 * n.getX(i), 0, 1));
    c.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  return g;
}

function dresserParts() {
  const parts = [
    painted(box(1.1, 1.0, 0.5), "#6b4127", at(0, 0.55, 0)),
    painted(box(1.18, 0.05, 0.56), "#7d4d2d", at(0, 1.07, 0)),
    ...[-0.45, 0.45].flatMap((x) => [-0.18, 0.18].map((z) => painted(box(0.06, 0.06, 0.06), "#4e2f1c", at(x, 0.03, z)))),
  ];
  for (let i = 0; i < 4; i++) {
    const y = 0.2 + i * 0.235;
    parts.push(painted(box(1.0, 0.2, 0.025), "#7a4a2b", at(0, y, 0.26)));
    for (const x of [-0.28, 0.28]) parts.push(painted(new THREE.SphereGeometry(0.022, 8, 6), "#c9a95c", at(x, y, 0.28)));
  }
  return parts;
}

/** Puerta abierta a un cuarto a oscuras (contra la pared, frente hacia +Z local). */
function darkDoorwayParts() {
  return [
    painted(box(0.1, 2.25, 0.06), "#5a3a24", at(-0.5, 1.12, 0.03)),
    painted(box(0.1, 2.25, 0.06), "#5a3a24", at(0.5, 1.12, 0.03)),
    painted(box(1.1, 0.1, 0.06), "#5a3a24", at(0, 2.25, 0.03)),
    painted(box(0.9, 2.2, 0.02), "#15120f", at(0, 1.1, 0.012)),
  ];
}

function bedParts() {
  // Larga a lo largo de Z local; la cabecera hacia -Z.
  return [
    painted(box(1.4, 0.32, 2.0), "#6b4127", at(0, 0.16, 0)),
    painted(box(1.4, 0.95, 0.08), "#6b4127", at(0, 0.48, -1.0)),
    painted(box(1.3, 0.2, 1.9), "#f2efe6", at(0, 0.42, 0)),
    painted(box(1.34, 0.07, 1.25), "#2c6b57", at(0, 0.55, 0.32)),
    painted(box(0.9, 0.12, 0.38), "#ffffff", at(0, 0.58, -0.7)),
  ];
}

/** Reloj de pie sin agujas (frente hacia +Z local). */
function clockParts() {
  return [
    painted(box(0.5, 1.9, 0.32), "#5a3a24", at(0, 0.95, 0)),
    painted(box(0.6, 0.12, 0.38), "#4a2f1d", at(0, 1.96, 0)),
    painted(new THREE.CircleGeometry(0.17, 24), "#f3ead2", at(0, 1.6, 0.165)),
    painted(box(0.22, 0.7, 0.01), "#1c1611", at(0, 0.85, 0.165)),
    painted(new THREE.SphereGeometry(0.06, 10, 8), "#c9a95c", at(0, 0.62, 0.17)),
  ];
}

/** Charco de cielo en la alfombra: un óvalo que deja ver el cielo de abajo, con nubes. */
function skyHoleParts() {
  const hole = painted(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2).scale(1.15, 1, 0.8), "#ffffff", at(0, 0.006, 0));
  const p = hole.attributes.position;
  const c = hole.attributes.color;
  const deep = new THREE.Color("#2f7fe0");
  const edge = new THREE.Color("#d4ebfc");
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i) / 1.15, p.getZ(i) / 0.8);
    tmp.copy(deep).lerp(edge, THREE.MathUtils.smoothstep(r, 0.2, 1));
    c.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  // Nubes vistas desde arriba, achatadas contra el cielo.
  const clouds = [
    [-0.35, 0.15, 0.32],
    [0.3, -0.2, 0.26],
    [0.55, 0.25, 0.18],
  ].map(([x, z, r]) => {
    const g = puff(0, 0, 0, r);
    g.scale(1.2, 0.02, 1);
    return g.translate(x, 0.008, z);
  });
  return [hole, ...clouds];
}

/** Piezas de un objeto en el mapa: las normales (se hornean) y las que brillan solas. */
function propParts(level: Level, prop: Prop): { lit: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const cell = cellAt(level, Math.floor(prop.x), Math.floor(prop.z));
  const floorY = isPool(cell) ? -POOL_DEPTH : 0;
  const ceiling = ceilingOf(cell);
  const place = new THREE.Matrix4().makeRotationY(prop.rotation).setPosition(prop.x, floorY, prop.z);
  let lit: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  switch (prop.kind) {
    case "paintedDoor":
      lit = doorParts(1);
      break;
    case "tinyDoor":
      lit = doorParts(0.38);
      break;
    case "chair":
      lit = chairParts();
      break;
    case "ceilingTable": {
      // Mesa y sillas pegadas al techo, patas arriba.
      const flip = new THREE.Matrix4().makeTranslation(0, ceiling - floorY, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI));
      lit = tableParts().map((g) => g.applyMatrix4(flip));
      break;
    }
    case "stairsUp": {
      // Escalones hacia +X que se meten en el techo (se suben: stairsUpHeight).
      const { steps, run, width } = STAIRS_UP;
      for (let i = 0; i < steps; i++) {
        const h = (i + 1) * stairsUpRise(ceiling);
        lit.push(painted(box(run, h, width), "#e4e8e6", at(i * run + run / 2, h / 2, width / 2)));
      }
      break;
    }
    case "doorFrame":
      lit = [
        painted(box(0.14, 2.35, 0.14), TRIM, at(-0.6, 1.17, 0)),
        painted(box(0.14, 2.35, 0.14), TRIM, at(0.6, 1.17, 0)),
        painted(box(1.34, 0.14, 0.14), TRIM, at(0, 2.3, 0)),
      ];
      break;
    case "skyWindow": {
      // Una ventana que siempre da a un cielo de mediodía (también de noche).
      const W = 2.4;
      const H = 1.6;
      const Y = 2.6;
      lit = [
        painted(box(W + 0.24, 0.12, 0.08), TRIM, at(0, Y + H / 2 + 0.06, 0.04)),
        painted(box(W + 0.24, 0.12, 0.08), TRIM, at(0, Y - H / 2 - 0.06, 0.04)),
        painted(box(0.12, H, 0.08), TRIM, at(-W / 2 - 0.06, Y, 0.04)),
        painted(box(0.12, H, 0.08), TRIM, at(W / 2 + 0.06, Y, 0.04)),
        painted(box(0.06, H, 0.05), TRIM, at(0, Y, 0.05)),
      ];
      const sky = painted(new THREE.PlaneGeometry(W, H, 1, 4), "#ffffff", at(0, Y, 0.02));
      const p = sky.attributes.position;
      const c = sky.attributes.color;
      const top = new THREE.Color("#3f8fe6");
      const bottom = new THREE.Color("#d6ecfb");
      const tmp = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        tmp.copy(bottom).lerp(top, THREE.MathUtils.clamp((p.getY(i) - (Y - H / 2)) / H, 0, 1));
        c.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      glow.push(sky);
      break;
    }
    // Las nubes ("cloud") se dibujan aparte, con partículas suaves que se atraviesan (Clouds.tsx).
    case "skyOpening": {
      // Arriba de la escalera, la pared se abre a un cielo de mediodía con nubes.
      const W = 3;
      const Y0 = 0.9;
      const Y1 = 6;
      const sky = painted(new THREE.PlaneGeometry(W, Y1 - Y0, 1, 6), "#ffffff", at(0, (Y0 + Y1) / 2, 0.02));
      const p = sky.attributes.position;
      const c = sky.attributes.color;
      const top = new THREE.Color("#2f7fe0");
      const bottom = new THREE.Color("#cfe6fb");
      const tmp = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        tmp.copy(bottom).lerp(top, THREE.MathUtils.clamp((p.getY(i) - Y0) / (Y1 - Y0), 0, 1));
        c.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      glow.push(sky);
      // Nubes lejanas: bultos achatados contra el cielo.
      for (const [x, y, r] of [
        [-0.8, 3.6, 0.55],
        [-0.25, 3.9, 0.7],
        [0.35, 3.7, 0.5],
        [0.9, 4.6, 0.4],
        [-1.1, 4.9, 0.35],
      ])
        glow.push(puff(x, y, 0.06, r, 0.08));
      break;
    }
    case "dresser":
      lit = dresserParts();
      break;
    case "painting":
      lit = [
        painted(box(0.9, 1.2, 0.05), "#a8843c", at(0, 1.75, 0.025)),
        painted(box(0.76, 1.06, 0.02), "#4a5640", at(0, 1.75, 0.055)),
        painted(box(0.16, 0.55, 0.01), "#26271f", at(0, 1.62, 0.07)),
        painted(new THREE.SphereGeometry(0.06, 8, 6), "#26271f", at(0, 1.95, 0.07)),
      ];
      break;
    case "sconce":
      lit = [painted(box(0.12, 0.22, 0.03), "#b08d4a", at(0, 1.75, 0.015)), painted(box(0.14, 0.03, 0.1), "#b08d4a", at(0, 1.82, 0.06))];
      for (const x of [-0.045, 0.045]) glow.push(painted(new THREE.SphereGeometry(0.035, 8, 6), "#fff1c9", at(x, 1.88, 0.08)));
      break;
    case "darkDoorway":
      lit = darkDoorwayParts();
      break;
    case "bed":
      lit = bedParts();
      break;
    case "clock":
      lit = clockParts();
      break;
    case "ceilingDoor": {
      // Una puerta acostada en el techo, mirando hacia abajo.
      const onCeiling = at(0, ceiling - floorY, 0)
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(at(0, -1.12, 0));
      lit = doorParts(1).map((g) => g.applyMatrix4(onCeiling));
      break;
    }
    case "floatingChair": {
      // Flotando a media altura, ladeada.
      const float = at(0, 1.2, 0).multiply(new THREE.Matrix4().makeRotationZ(0.45)).multiply(new THREE.Matrix4().makeRotationX(-0.3));
      lit = chairParts().map((g) => g.applyMatrix4(float));
      break;
    }
    case "skyHole":
      glow.push(...skyHoleParts());
      break;
    case "upsideDownPainting": {
      const flip = at(0, 1.75, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI)).multiply(at(0, -1.75, 0));
      lit = [
        painted(box(0.7, 0.95, 0.05), "#a8843c", at(0, 1.75, 0.025)),
        painted(box(0.58, 0.83, 0.02), "#6d8a9a", at(0, 1.75, 0.055)),
        // Una casita con su techo: al revés se nota.
        painted(box(0.3, 0.22, 0.01), "#efe2c4", at(0, 1.6, 0.07)),
        painted(box(0.36, 0.1, 0.01), "#7a4a34", at(0, 1.76, 0.07)),
        painted(box(0.58, 0.18, 0.012), "#3f7a3a", at(0, 1.42, 0.068)),
      ].map((g) => g.applyMatrix4(flip));
      break;
    }
  }
  return { lit: lit.map((g) => g.applyMatrix4(place)), glow: glow.map((g) => strip(g.applyMatrix4(place))) };
}

// --- Geometría de un interior ---

interface LevelGeometry {
  solid: THREE.BufferGeometry;
  panels: THREE.BufferGeometry | null;
  flicker: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}

const mergeOrNull = (parts: THREE.BufferGeometry[]) => (parts.length ? mergeGeometries(parts) : null);

/** Piso, techo y paredes de una celda del mapa (y el agua si es piscina). */
function cellPieces(level: Level, x: number, z: number, solid: THREE.BufferGeometry[], water: THREE.BufferGeometry[]) {
  const { palette } = level;
  const c = cellAt(level, x, z);
  // Tras la puerta no hay nada: ahí se ve el portal. Las celdas de la puerta van con su hueco (doorwayPieces).
  if (isVoid(c) || c === "D") return;
  if (isFloor(c)) {
    const top = isPool(c) ? -POOL_DEPTH : 0;
    const floorSurface = isPool(c) ? SURFACE.poolFloor : SURFACE.floor;
    solid.push(tag(painted(box(1, top + 0.5, 1), palette.floor, at(x + 0.5, (top - 0.5) / 2, z + 0.5)), floorSurface));
    const h = ceilingOf(c);
    solid.push(tag(painted(box(1, 0.2, 1), palette.ceiling, at(x + 0.5, h + 0.1, z + 0.5)), SURFACE.ceiling));
    // Junto a una sala de techo alto, se cierra con pared el espacio sobre el techo bajo.
    let above = h;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const n = cellAt(level, x + dx, z + dz);
      if (isFloor(n)) above = Math.max(above, ceilingOf(n));
    }
    if (above > h) solid.push(tag(painted(box(1, above - h, 1), palette.wall, at(x + 0.5, h + 0.2 + (above - h) / 2, z + 0.5)), SURFACE.wall));
    if (isPool(c)) water.push(painted(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), "#ffffff", at(x + 0.5, -0.06, z + 0.5)));
    return;
  }
  // Pared: solo si toca un piso; tan alta como el techo más alto que toca.
  let top = -1;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const n = cellAt(level, x + dx, z + dz);
      if (isFloor(n)) top = Math.max(top, ceilingOf(n));
    }
  }
  if (top < 0) return;
  solid.push(tag(painted(box(1, top + 0.7, 1), palette.wall, at(x + 0.5, (top + 0.2 - 0.5) / 2, z + 0.5)), SURFACE.wall));
}

/** Plafón o tubo de una luz (mirando hacia abajo). */
function lightPanel(level: Level, l: Light) {
  // Tubos fluorescentes; en el pasillo de la nube, plafones redondos.
  const shape = level.kind === "cloudhall" ? new THREE.CircleGeometry(0.16, 20) : new THREE.PlaneGeometry(1.2, 0.36);
  return strip(painted(shape.rotateX(Math.PI / 2), "#ffffff", at(l.x, l.y - 0.01, l.z)));
}

/** Se conservan las normales (el shader las usa para proyectar la textura de cada cara). */
function bakeAll(level: Level, parts: THREE.BufferGeometry[]) {
  return parts.map((g) => {
    bake(g, level.lights);
    g.deleteAttribute("uv");
    return g;
  });
}

/**
 * La copia del pasillo de entrada (de la puerta a una columna más allá del portal), para
 * dibujarla dentro de la casa real: celdas, hueco de la puerta y luces de esa zona.
 */
function buildReplica(level: Level): LevelGeometry | null {
  const area = level.replica;
  if (!area) return null;
  const solid: THREE.BufferGeometry[] = [];
  const water: THREE.BufferGeometry[] = [];
  for (let x = area.x0; x <= area.x1; x++) for (let z = area.z0; z <= area.z1; z++) cellPieces(level, x, z, solid, water);
  solid.push(...doorwayPieces(level));
  // Las paredes de la fila de la puerta llegan a la cara exterior: en la casa real quedarían
  // pegadas a la fachada y se verían por fuera. Se recortan para que terminen detrás del
  // muro de la casa (el marco blanco de la puerta real tapa ese tramo).
  const facade = level.door.z + 1 - (WALL + 0.02);
  for (const g of solid) {
    if (g.attributes.surface.getX(0) !== SURFACE.wall) continue;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > facade) pos.setZ(i, facade);
  }
  const inside = (l: Light) => l.x >= area.x0 && l.x <= area.x1 + 1 && l.z >= area.z0 && l.z <= area.z1 + 1;
  const lights = level.lights.filter(inside);
  return {
    solid: mergeGeometries(bakeAll(level, solid))!,
    panels: mergeOrNull(lights.filter((l) => !l.flicker).map((l) => lightPanel(level, l))),
    flicker: mergeOrNull(lights.filter((l) => l.flicker).map((l) => lightPanel(level, l))),
    water: mergeOrNull(water.map(strip)),
    glow: null,
  };
}

/** Todo el interior, en coordenadas del mapa. */
function buildLevel(level: Level): LevelGeometry {
  const solid: THREE.BufferGeometry[] = [];
  const water: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  const flicker: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];

  for (let x = level.minX; x <= level.maxX; x++) for (let z = level.minZ; z <= level.maxZ; z++) cellPieces(level, x, z, solid, water);
  solid.push(...doorwayPieces(level));

  for (const prop of level.props) {
    const { lit, glow: g } = propParts(level, prop);
    solid.push(...lit.map((g) => tag(g, SURFACE.prop)));
    glow.push(...g);
  }

  for (const l of level.lights) (l.flicker ? flicker : panels).push(lightPanel(level, l));

  return {
    solid: mergeGeometries(bakeAll(level, solid))!,
    panels: mergeOrNull(panels),
    flicker: mergeOrNull(flicker),
    water: mergeOrNull(water.map(strip)),
    glow: mergeOrNull(glow),
  };
}

/** El hueco de la puerta: jambas y dintel dejan un hueco igual al de la casa, con marco blanco por dentro. */
function doorwayPieces(level: Level) {
  const { palette } = level;
  const doorway: THREE.BufferGeometry[] = [];
  for (const j of doorJambs(level)) {
    const w = j.maxX - j.minX;
    doorway.push(tag(painted(box(w, CEILING + 0.7, 1), palette.wall, at(j.minX + w / 2, (CEILING + 0.2 - 0.5) / 2, j.minZ + 0.5)), SURFACE.wall));
  }
  const { x: dx, z: dz } = level.door;
  const lintel = CEILING - DOOR.height;
  doorway.push(tag(painted(box(DOOR.width, lintel + 0.2, 1), palette.wall, at(dx, DOOR.height + (lintel + 0.2) / 2, dz + 0.5)), SURFACE.wall));
  doorway.push(tag(painted(box(DOOR.width + 0.3, 0.15, 0.06), TRIM, at(dx, DOOR.height + 0.07, dz - 0.03)), SURFACE.prop));
  for (const sx of [-1, 1])
    doorway.push(tag(painted(box(0.15, DOOR.height, 0.06), TRIM, at(dx + sx * (DOOR.width / 2 + 0.07), DOOR.height / 2, dz - 0.03)), SURFACE.prop));
  // Piso y techo del hueco (las celdas de la puerta).
  for (const x of [dx - 1, dx]) {
    doorway.push(tag(painted(box(1, 0.5, 1), palette.floor, at(x + 0.5, -0.25, dz + 0.5)), SURFACE.floor));
    doorway.push(tag(painted(box(1, 0.2, 1), palette.ceiling, at(x + 0.5, CEILING + 0.1, dz + 0.5)), SURFACE.ceiling));
  }
  return doorway;
}

// --- Componente ---

function LevelMeshes({ level, blend, animated }: { level: Level; blend: BlendRef; animated: boolean }) {
  const geometry = useMemo(() => buildLevel(level), [level]);
  const replica = useMemo(() => buildReplica(level), [level]);
  useEffect(
    () => () => {
      if (replica) for (const g of Object.values(replica)) g?.dispose();
    },
    [replica]
  );
  const materials = useMemo(
    () => ({
      solid: surfaceMaterial(level.kind),
      panel: new THREE.MeshBasicMaterial({ color: level.palette.panelDay, side: THREE.DoubleSide, toneMapped: false }),
      flicker: new THREE.MeshBasicMaterial({ color: level.palette.panelDay, side: THREE.DoubleSide, toneMapped: false }),
      water: waterMaterial(),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }),
    }),
    [level]
  );
  useEffect(
    () => () => {
      for (const g of Object.values(geometry)) g?.dispose();
      Object.values(materials).forEach((m) => m.dispose());
    },
    [geometry, materials]
  );

  const colors = useMemo(
    () => ({
      night: new THREE.Color(level.palette.night),
      panelDay: new THREE.Color(level.palette.panelDay),
      waterDay: new THREE.Color("#8fd3dd"),
      waterNight: new THREE.Color("#2f5a70"),
    }),
    [level]
  );

  useFrame(({ clock }) => {
    const night = 1 - blend.current;
    materials.solid.color.copy(WHITE).lerp(colors.night, night);
    materials.panel.color.copy(colors.panelDay).lerp(COLD_LIGHT, night);
    materials.water.color.copy(colors.waterDay).lerp(colors.waterNight, night);
    // Parpadeo: cortes breves e irregulares (más seguidos de noche).
    const t = animated ? clock.elapsedTime : 0;
    interiorTime.value = t;
    const n = Math.sin(t * 23.1) * Math.sin(t * 7.3 + 1.7) * Math.sin(t * 1.9 + 0.4);
    const off = n > 0.55 - night * 0.25 ? 0.18 : 1;
    materials.flicker.color.copy(materials.panel.color).multiplyScalar(off);
  });

  const meshes = (set: LevelGeometry) => (
    <>
      <mesh geometry={set.solid} material={materials.solid} raycast={() => null} />
      {set.panels && <mesh geometry={set.panels} material={materials.panel} raycast={() => null} />}
      {set.flicker && <mesh geometry={set.flicker} material={materials.flicker} raycast={() => null} />}
      {set.water && <mesh geometry={set.water} material={materials.water} renderOrder={1} raycast={() => null} />}
      {set.glow && <mesh geometry={set.glow} material={materials.glow} raycast={() => null} />}
    </>
  );

  return (
    <>
      <group position={level.remote.toArray()}>
        {meshes(geometry)}
        <Clouds level={level} animated={animated} />
      </group>
      {/* El pasillo de entrada, copiado dentro de la casa real hasta el portal (sin corte al cruzar). */}
      {replica && <group position={replicaOrigin(level).toArray()}>{meshes(replica)}</group>}
    </>
  );
}

export default function Interiors({ blend, animated }: { blend: BlendRef; animated: boolean }) {
  return (
    <>
      {LEVELS.map((level) => (
        <LevelMeshes key={level.kind} level={level} blend={blend} animated={animated} />
      ))}
    </>
  );
}
