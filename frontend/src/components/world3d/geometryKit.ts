// ==========================================
// geometryKit.ts - PIEZAS PARA UNIR EN UNA SOLA MALLA
// ==========================================
// El prado y los interiores se arman con muchas piezas simples (cajas) que se unen
// en pocas mallas con color por vértice: pocos draw calls.

import * as THREE from "three";

/** Copia no indexada con un color por vértice, lista para unir con otras. */
export function painted(geometry: THREE.BufferGeometry, color: string | THREE.Color, matrix?: THREE.Matrix4) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

export const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

export const box = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);
