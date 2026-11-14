// ==========================================
// echoesStore.ts - ECOS: NOTAS DE LOS VISITANTES (DATOS)
// ==========================================
// Lista de ecos que vienen del backend (/api/ecos, guardados en MySQL), compartida
// entre la escena (Echoes.tsx) y la interfaz (World3D). Se recarga cada cierto tiempo
// para ver las notas que dejan otros visitantes.
//
// Los "Yo también estuve aquí" de este navegador se recuerdan en localStorage para
// que cada visitante sume solo uno por eco.

import { useSyncExternalStore } from "react";
import type { InteriorKind } from "./liminal";

export type Zone = "prado" | InteriorKind;

export interface Echo {
  id: number;
  texto: string;
  x: number;
  y: number;
  z: number;
  zona: Zone;
  likes: number;
}

export const ECHO_MAX_LENGTH = 140;

const API = import.meta.env.VITE_ECOS_URL ?? "/api/ecos";
const REFRESH_MS = 30000;
const LIKED_KEY = "ecos.liked";

let echoes: Echo[] = [];
const listeners = new Set<() => void>();

function emit(next: Echo[]) {
  echoes = next;
  listeners.forEach((listener) => listener());
}

function readLiked(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKED_KEY) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

const liked = readLiked();

export const hasLiked = (id: number) => liked.has(id);

export async function loadEchoes() {
  try {
    const response = await fetch(API);
    if (!response.ok) return;
    emit((await response.json()) as Echo[]);
  } catch {
    // Sin backend el mundo sigue igual, solo sin ecos.
  }
}

/** Publica un eco. Devuelve el mensaje de error del backend si no se pudo. */
export async function createEcho(echo: Omit<Echo, "id" | "likes">): Promise<string | null> {
  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(echo),
    });
    const data = (await response.json()) as Echo & { error?: string };
    if (!response.ok) return data.error ?? response.statusText;
    emit([data, ...echoes.filter((e) => e.id !== data.id)]);
    return null;
  } catch {
    return "network";
  }
}

export async function likeEcho(id: number) {
  if (liked.has(id)) return;
  liked.add(id);
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify([...liked]));
  } catch {
    // Sin almacenamiento solo dura esta visita.
  }
  // Se ve al instante; si falla, se deshace.
  emit(echoes.map((e) => (e.id === id ? { ...e, likes: e.likes + 1 } : e)));
  try {
    const response = await fetch(`${API}/${id}/like`, { method: "POST" });
    if (!response.ok) throw new Error(response.statusText);
    const data = (await response.json()) as { likes: number };
    emit(echoes.map((e) => (e.id === id ? { ...e, likes: data.likes } : e)));
  } catch {
    liked.delete(id);
    emit(echoes.map((e) => (e.id === id ? { ...e, likes: e.likes - 1 } : e)));
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // El primero que se suscribe arranca la carga y la recarga periódica; el último la para.
  if (listeners.size === 1) {
    void loadEchoes();
    timer = setInterval(() => void loadEchoes(), REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
};

export const useEchoes = () => useSyncExternalStore(subscribe, () => echoes);
