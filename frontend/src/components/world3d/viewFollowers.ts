// ==========================================
// viewFollowers.ts - LO QUE ACOMPAÑA A LA CÁMARA
// ==========================================
// El cielo, las estrellas y el parche de pasto se colocan alrededor de la cámara del
// jugador. Cuando Portals.tsx dibuja desde una cámara virtual (la vista por una
// puerta), los llama con esa cámara antes de dibujar y con la del jugador después.

import type * as THREE from "three";

export const viewFollowers = new Set<(camera: THREE.Camera) => void>();

export function followView(camera: THREE.Camera) {
  viewFollowers.forEach((follow) => follow(camera));
}
