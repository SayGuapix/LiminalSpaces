// ==========================================
// devicePerformance.ts - DETECCIÓN DE EQUIPOS LENTOS
// ==========================================
// 1. prefers-reduced-motion: el usuario pidió menos movimiento en su sistema operativo.
// 2. Pistas del hardware: ahorro de datos activado, poca RAM (navigator.deviceMemory,
//    solo Chromium) o pocos núcleos (hardwareConcurrency).

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function detectLowEndDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithHints;
  if (nav.connection?.saveData) return true;
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return true;
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2) return true;
  return false;
}
