// ==========================================
// shared.tsx - PIEZAS COMUNES DEL MUNDO 3D
// ==========================================
// Tipos, colisiones, el objetivo que mira el jugador y el texto 3D (fuente Inter).

import { useSyncExternalStore } from "react";
import { Text } from "@react-three/drei";

export type Vec3 = [number, number, number];

/** Algo que el jugador puede mirar; si tiene action, también puede usarse con E o click. */
export interface Interactable {
  id: string;
  label?: string;
  action?: () => void;
}

/** Caja de colisión en el plano del suelo (XZ); con circle, es un círculo. */
export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  circle?: { x: number; z: number; r: number };
  /** Rango de altura (opcional): fuera de él se pasa por encima o por debajo (casas del agujero). */
  minY?: number;
  maxY?: number;
}

export function circleCollider(x: number, z: number, r: number): Collider {
  return { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, circle: { x, z, r } };
}

/** Calcula la caja de colisión de un objeto rotado sobre el eje Y. */
export function colliderFor(position: Vec3, rotationY: number, width: number, depth: number): Collider {
  const c = Math.abs(Math.cos(rotationY));
  const s = Math.abs(Math.sin(rotationY));
  const halfX = (c * width + s * depth) / 2;
  const halfZ = (s * width + c * depth) / 2;
  return {
    minX: position[0] - halfX,
    maxX: position[0] + halfX,
    minZ: position[2] - halfZ,
    maxZ: position[2] + halfZ,
  };
}

// --- Objeto que el jugador está mirando ---
// Vive fuera de React: al cambiar, solo se re-renderizan los componentes que lo leen.

let currentTarget: Interactable | null = null;
const targetListeners = new Set<() => void>();

export const targetStore = {
  get: () => currentTarget,
  /** notify=false solo actualiza el objeto (su acción puede depender del estado actual). */
  set(target: Interactable | null, notify = true) {
    currentTarget = target;
    if (notify) targetListeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    targetListeners.add(listener);
    return () => {
      targetListeners.delete(listener);
    };
  },
};

/** true si lo que se mira tiene una acción (la mira cambia de estilo). */
export const useTargetHasAction = () => useSyncExternalStore(targetStore.subscribe, () => !!currentTarget?.action);

// --- Texto ---

export const FONTS = {
  400: "/fonts/inter/inter-400.woff",
  500: "/fonts/inter/inter-500.woff",
  600: "/fonts/inter/inter-600.woff",
  700: "/fonts/inter/inter-700.woff",
  900: "/fonts/inter/inter-900.woff",
} as const;

type TextProps = React.ComponentProps<typeof Text>;

/**
 * Texto 3D con la fuente Inter. `size` y `glow` van en metros;
 * glow es un halo blanco difuso con opacidad `glowOpacity`.
 */
export function UIText({
  weight = 400,
  size,
  glow,
  glowOpacity = 0.3,
  tracking = 0,
  opacity = 1,
  children,
  ...rest
}: Omit<TextProps, "font" | "fontSize"> & {
  weight?: keyof typeof FONTS;
  size: number;
  glow?: number;
  glowOpacity?: number;
  tracking?: number;
  opacity?: number;
}) {
  return (
    <Text
      font={FONTS[weight]}
      fontSize={size}
      letterSpacing={tracking}
      color="#ffffff"
      fillOpacity={opacity}
      anchorX="center"
      anchorY="middle"
      {...(glow
        ? { outlineWidth: 0, outlineBlur: glow, outlineColor: "#ffffff", outlineOpacity: glowOpacity }
        : {})}
      {...rest}
    >
      {children}
    </Text>
  );
}
