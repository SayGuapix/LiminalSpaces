// ==========================================
// quality.ts - NIVELES DE CALIDAD DEL MUNDO 3D
// ==========================================
// El mundo arranca en un nivel según la GPU y baja solo si los FPS caen
// (PerformanceMonitor en World3D). Nunca sube durante la sesión: así no oscila.
//
// Lo que cambia entre niveles: pasto, sombras, resolución y la vista por las puertas.

export type QualityTier = "low" | "medium" | "high";

export interface QualitySettings {
  /** Rango de devicePixelRatio del Canvas. */
  dpr: [number, number];
  /** Briznas de pasto alrededor del jugador. */
  grassBlades: number;
  /** Lado del mapa de sombras del sol (0 = sin sombras). */
  shadowMapSize: number;
  /** Resolución de la vista por las puertas de las casas (fracción del lienzo). */
  portalScale: number;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: { dpr: [0.75, 1], grassBlades: 20000, shadowMapSize: 0, portalScale: 0.5 },
  medium: { dpr: [1, 1.25], grassBlades: 40000, shadowMapSize: 1024, portalScale: 0.75 },
  high: { dpr: [1, 1.75], grassBlades: 70000, shadowMapSize: 2048, portalScale: 1 },
};

const ORDER: QualityTier[] = ["low", "medium", "high"];

/** El nivel inmediatamente inferior (low se queda en low). */
export function lowerTier(tier: QualityTier): QualityTier {
  return ORDER[Math.max(0, ORDER.indexOf(tier) - 1)];
}

/** Nombre de la GPU según WebGL (vacío si el navegador lo oculta). */
function gpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return String(name ?? "");
  } catch {
    return "";
  }
}

/**
 * Nivel inicial a partir del nombre de la GPU y del equipo. Es una estimación
 * conservadora: si hay duda se elige medium y PerformanceMonitor ajusta.
 */
export function detectTier(lowPerformance: boolean, gpu = gpuName()): QualityTier {
  if (lowPerformance) return "low";
  const name = gpu.toLowerCase();
  // Render por software o GPUs de móviles y gráficas integradas antiguas.
  if (/swiftshader|llvmpipe|software|mali|adreno|powervr|intel\(r\) (hd|uhd)|intel hd|intel uhd/.test(name)) return "low";
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const memory = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  if (cores <= 4 || (memory !== undefined && memory <= 4)) return "low";
  // Gráficas dedicadas y Apple Silicon.
  if (/geforce|rtx|gtx|radeon rx|radeon pro|apple m\d|arc a\d/.test(name)) return "high";
  return "medium";
}
