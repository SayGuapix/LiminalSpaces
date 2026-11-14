// ==========================================
// worldMap.ts - MAPA DEL MUNDO 3D
// ==========================================
// El prado liminal (liminal.ts): pasto, colinas, casas, la torre de agua y el agujero.
// Se recorre libremente dentro de un límite amplio.
// Ejes: +Z es "hacia el frente" (donde aparece el jugador), +X a la derecha.

import { HOLE, interiorFloor, stairsHeight, terrainHeight } from "./liminal";
import { REMOTE_X_MIN, interiorGround } from "./interiorMaps";

/** Altura del pasto en el centro del prado (lejos, las colinas lo levantan: liminal.ts). */
export const GRASS_Y = 0;

/** Altura del suelo en (x, z): interiores, escalera, casas o pasto. */
export function groundHeight(x: number, z: number) {
  // Interiores lejanos de las casas (más grandes por dentro: interiorMaps.ts).
  if (x >= REMOTE_X_MIN) return interiorGround(x, z) ?? 0;
  // La escalera del prado: cada peldaño es suelo.
  const stairs = stairsHeight(x, z);
  if (stairs !== null) return Math.max(stairs, terrainHeight(x, z));
  // Dentro de una casa que se puede entrar, su piso.
  return interiorFloor(x, z) ?? terrainHeight(x, z);
}

/** Límite del mundo: un círculo amplio alrededor del mapa, que llega a las colinas. */
const WORLD_LIMIT = { x: 12, z: 6, r: 100 };

/** true si un círculo de radio `radius` en (x, z) queda dentro del mundo. */
export function isWalkable(x: number, z: number, radius: number) {
  // En los interiores lejanos mandan sus paredes (colisiones).
  if (x >= REMOTE_X_MIN) return true;
  if (Math.hypot(x - WORLD_LIMIT.x, z - WORLD_LIMIT.z) <= WORLD_LIMIT.r - radius) return true;
  // El agujero (su borde toca el límite): se puede bajar por él.
  return Math.hypot(x - HOLE.x, z - HOLE.z) <= HOLE.radius + 3 - radius;
}

// --- Cámara ---

/** Donde aparece el jugador: en medio del prado, mirando a la casa amarilla. */
export const SPAWN = { x: 6, z: 4 };
export const SPAWN_LOOK = { x: 18, z: -21 };

/** Destinos de los atajos del menú de pausa: dónde queda el jugador y hacia dónde mira. */
export const WARPS = {
  home: { x: SPAWN.x, z: SPAWN.z, look: SPAWN_LOOK },
  // Frente a la puerta de la casa amarilla (el pasillo de la nube).
  cloudhall: { x: 18, z: -12, look: { x: 18, z: -21 } },
  // Frente a la puerta de la casa de las Poolrooms.
  poolrooms: { x: -47, z: 7, look: { x: -47, z: -2 } },
} as const;
export type WarpId = keyof typeof WARPS;
