// ==========================================
// BackendStatus.tsx - ESTADO DE LA CONEXIÓN CON EL BACKEND
// ==========================================
// Pide a la API el mensaje guardado en MySQL. Se muestra dentro del panel de la F
// (World3D), para no ocupar la pantalla mientras se explora.
// La petición va a /api/estado del mismo origen: Nginx (contenedor frontend) la
// reenvía al contenedor backend por la red interna de Docker (ver nginx.conf).
// Si falla, reintenta cada pocos segundos (la base de datos puede tardar en arrancar).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const API_URL = import.meta.env.VITE_API_URL ?? "/api/estado";
const RETRY_MS = 5000;

export type BackendState = { state: "loading" } | { state: "ok"; message: string } | { state: "error" };

/** Consulta el backend una vez al entrar (y reintenta si falla): el panel puede abrirse y cerrarse sin repetirla. */
export function useBackendStatus(): BackendState {
  const [status, setStatus] = useState<BackendState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await fetch(API_URL);
        const data = (await response.json()) as { mensaje?: string; error?: string };
        if (!response.ok || !data.mensaje) throw new Error(data.error ?? response.statusText);
        if (!cancelled) setStatus({ state: "ok", message: data.mensaje });
      } catch {
        if (cancelled) return;
        setStatus({ state: "error" });
        retry = setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  return status;
}

export default function BackendStatus({ status, light }: { status: BackendState; light: boolean }) {
  const { t } = useTranslation("world3d");
  const dot = status.state === "ok" ? "bg-emerald-400" : status.state === "error" ? "bg-red-500" : "bg-yellow-400 animate-pulse";
  const text =
    status.state === "ok" ? status.message : status.state === "error" ? t("backend.error") : t("backend.loading");

  return (
    <div
      className={`max-w-[min(340px,80vw)] rounded-xl border px-4 py-3 text-xs backdrop-blur-sm [text-shadow:none] ${
        light ? "border-zinc-300/70 bg-white/70 text-zinc-800" : "border-white/10 bg-black/50 text-white/85"
      }`}
    >
      <p className="flex items-center gap-2 font-semibold uppercase tracking-widest opacity-60">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {t("backend.title")}
      </p>
      <p className="mt-1.5 leading-snug">{text}</p>
    </div>
  );
}
