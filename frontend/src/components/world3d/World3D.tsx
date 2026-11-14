// ==========================================
// World3D.tsx - MUNDO 3D DE ESPACIOS LIMINALES
// ==========================================
// Pantalla completa con un Canvas de Three.js (React Three Fiber). Al entrar no hay
// menú: se camina directamente y la primera tecla de movimiento (o un click) bloquea
// el ratón. Abajo a la izquierda, las etiquetas "F" (panel) y "Esc" (pausa).
// El panel de la F muestra el estado del backend, los controles y cómo dejar firmas.
// Esc abre el menú de pausa (atajos, controles y Continuar).
// N abre el cuadro para dejar una firma (eco) donde está el jugador (Echoes.tsx).
// Atajos: ir al inicio o a la puerta de una de las casas (traslada al jugador y sigue el
// juego), cambiar entre modo claro y oscuro y cambiar de idioma.
//
// Estado del backend (en el panel de la F): el mensaje que la API (Node.js) lee de
// la base de datos (MySQL), para comprobar la conexión completa entre contenedores.
//
// Calidad: arranca en un nivel según la GPU (quality.ts) y PerformanceMonitor lo baja
// si los FPS caen. El nivel solo cambia el mundo (resolución, pasto y sombras).

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/hooks/use-language";
import { motion, AnimatePresence } from "framer-motion";
import { Cloud, Home, Languages, Moon, Sun as SunIcon, Waves, type LucideIcon } from "lucide-react";
import type { WarpId } from "./worldMap";
import { useThemeContext } from "@/contexts/ThemeContext";
import Player, { INTRO_SECONDS } from "./Player";
import { LIMINAL_COLLIDERS } from "./liminal";
import { INTERIOR_COLLIDERS } from "./interiorMaps";
import { targetStore, useTargetHasAction } from "./shared";
import ThemeSky, { SKY_COLORS } from "./ThemeSky";
import Sun from "./Sun";
import BackendStatus, { useBackendStatus } from "./BackendStatus";
import Echoes, { type EchoLabels, type EchoSpot } from "./Echoes";
import { ECHO_MAX_LENGTH, createEcho } from "./echoesStore";
import { QUALITY, detectTier, lowerTier, type QualityTier } from "./quality";

type Phase = "intro" | "ready" | "playing" | "paused" | "writing";

/** Duración del despertar (párpados y desenfoque), igual que la de la cámara. */
const WAKE_SECONDS = INTRO_SECONDS;
/**
 * Secuencia del despertar (fracciones de WAKE_SECONDS): dos parpadeos rápidos, una
 * pausa con los ojos cerrados y la apertura final, lenta.
 */
const WAKE_TIMES = [0, 0.08, 0.15, 0.24, 0.31, 0.4, 1];
const WAKE_LIDS = [1, 0.4, 1, 0.3, 1, 1, 0];
const WAKE_BLUR = ["blur(14px)", "blur(12px)", "blur(12px)", "blur(10px)", "blur(10px)", "blur(9px)", "blur(0px)"];

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

// Colisiones de todo el mapa: el prado y los interiores de las casas.
const COLLIDERS = [...LIMINAL_COLLIDERS, ...INTERIOR_COLLIDERS];

// Nivel al que bajó la calidad en una visita anterior: la siguiente arranca ahí.
const TIER_KEY = "world3d.qualityTier";

function initialTier(lowPerformance: boolean): QualityTier {
  const detected = detectTier(lowPerformance);
  try {
    const saved = localStorage.getItem(TIER_KEY);
    if (saved === "low" || (saved === "medium" && detected === "high")) return saved;
  } catch {
    // Sin almacenamiento (modo privado, etc.): vale lo detectado.
  }
  return detected;
}

const PALETTES = {
  dark: { background: SKY_COLORS.dark },
  light: { background: SKY_COLORS.light },
} as const;

export default function World3D() {
  const { t } = useTranslation("world3d");
  const { theme, toggleTheme, reducedMotion, lowPerformance } = useThemeContext();
  const { language, setLanguage } = useLanguage();
  const backend = useBackendStatus();
  const palette = PALETTES[theme];
  const [tier, setTier] = useState<QualityTier>(() => initialTier(lowPerformance));
  const quality = QUALITY[tier];
  const declineQuality = useCallback(() => {
    setTier((current) => {
      const next = lowerTier(current);
      try {
        localStorage.setItem(TIER_KEY, next);
      } catch {
        // Sin almacenamiento: solo dura esta visita.
      }
      return next;
    });
  }, []);

  const controlsRef = useRef<PointerLockControlsImpl | null>(null);
  const warpRef = useRef<((to: WarpId) => void) | null>(null);
  const fadeRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [showHelp, setShowHelp] = useState(false);
  // Dónde quedaría un eco nuevo (lo deja Echoes, que tiene la cámara) y el que se escribe.
  const placeRef = useRef<(() => EchoSpot) | null>(null);
  const [draftSpot, setDraftSpot] = useState<EchoSpot | null>(null);
  const echoLabels = useMemo<EchoLabels>(
    () => ({
      like: t("echoes.like"),
      liked: t("echoes.liked"),
      count: (likes) => t("echoes.count", { count: likes }),
    }),
    [t]
  );
  // El despertar empieza cuando la escena terminó de cargar (Player montado).
  const [awake, setAwake] = useState(false);
  // El objetivo es global (store): se limpia al entrar al mundo.
  useEffect(() => {
    targetStore.set(null);
    return () => targetStore.set(null);
  }, []);

  // Pide bloquear el ratón. El navegador solo lo permite justo después de un gesto del
  // usuario (tecla o click); si lo rechaza no pasa nada: se puede caminar igual.
  const lock = useCallback(() => {
    const element = controlsRef.current?.domElement as HTMLElement | undefined;
    if (!element || document.pointerLockElement === element) return;
    // Sin gesto reciente el navegador lo rechazaría (y three avisa con un error en consola).
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return;
    try {
      const request = element.requestPointerLock() as unknown as Promise<void> | undefined;
      request?.catch?.(() => {});
    } catch {
      // Navegadores antiguos lanzan en lugar de rechazar la promesa.
    }
  }, []);

  // N: suelta el ratón y abre el cuadro del eco, fijando el lugar donde quedará.
  const startWriting = useCallback(() => {
    const spot = placeRef.current?.();
    if (!spot) return;
    setDraftSpot(spot);
    setPhase("writing");
    document.exitPointerLock?.();
  }, []);

  // Al cerrar el cuadro se vuelve a explorar (Enter o el botón cuentan como gesto).
  const stopWriting = useCallback(() => {
    setDraftSpot(null);
    setPhase("ready");
    lock();
  }, [lock]);

  // F muestra u oculta los controles. Sin el ratón bloqueado: la primera tecla de
  // movimiento lo bloquea y Esc abre la pausa. En pausa: Enter continúa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Mientras se escribe el eco, las teclas son del cuadro de texto.
      if (phase === "writing") return;
      if (e.code === "KeyN" && !e.repeat && (phase === "playing" || phase === "ready")) {
        e.preventDefault();
        startWriting();
        return;
      }
      if (phase === "paused") {
        if (e.key === "Enter") {
          e.preventDefault();
          lock();
        }
        return;
      }
      if (e.code === "KeyF" && !e.repeat) {
        setShowHelp((v) => !v);
        return;
      }
      if (phase !== "ready") return;
      // La primera tecla de movimiento también bloquea el ratón (las teclas cuentan como gesto).
      if (MOVE_KEYS.has(e.code) || e.key === "Enter") {
        lock();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPhase("paused");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, lock, startWriting]);

  const warp = (to: WarpId) => {
    warpRef.current?.(to);
    lock();
  };

  return (
    <motion.div
      className="fixed inset-0 select-none"
      style={{ background: palette.background }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      // Click en cualquier parte: bloquea el ratón y empieza a explorar.
      onClick={() => {
        if (phase === "ready") lock();
      }}
    >
      {/* Visión borrosa al despertar: el desenfoque solo existe durante la entrada. */}
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={
          phase === "intro" && awake
            ? { filter: WAKE_BLUR }
            : { filter: phase === "intro" ? "blur(14px)" : "blur(0px)" }
        }
        transition={{ duration: WAKE_SECONDS, times: WAKE_TIMES, ease: "easeOut" }}
        style={phase === "intro" ? undefined : { filter: "none" }}
      >
      <Canvas
        // far se ajusta en cada frame a la neblina (ver ThemeSky).
        camera={{ fov: 70, near: 0.05, far: 160 }}
        dpr={quality.dpr}
        // Sombras del sol: se hornean al cargar (ver Sun.tsx).
        shadows="soft"
        gl={{ antialias: true, stencil: true }}
        // Sin tone mapping: los colores se ven exactos.
        flat
      >
        {/* El sol (dirección 3, 8, 6) está en Sun, dentro del Suspense: hornea las sombras cuando el mundo ya cargó. */}
        <directionalLight position={[-4, 6, -2]} intensity={0.6} />

        <Suspense fallback={null}>
          <ThemeSky
            theme={theme}
            animated={!reducedMotion}
            lowPerformance={lowPerformance}
            grassBlades={quality.grassBlades}
            portalScale={quality.portalScale}
          />
          {/* Suspense propio: un eco nuevo (su texto) no esconde el resto de la escena. */}
          <Suspense fallback={null}>
            <Echoes placeRef={placeRef} labels={echoLabels} />
          </Suspense>
          <Player
            controlsRef={controlsRef}
            colliders={COLLIDERS}
            paused={phase === "paused" || phase === "writing"}
            warpRef={warpRef}
            fadeRef={fadeRef}
            onIntroStart={() => setAwake(true)}
            onIntroDone={() => {
              setPhase("ready");
              // Si el gesto que abrió la página aún cuenta como reciente, el ratón queda
              // bloqueado sin necesidad de click.
              lock();
            }}
            onLockChange={(locked) => {
              setPhase((p) => (locked ? "playing" : p === "playing" ? "paused" : p));
            }}
          />
          <Sun intensity={1.4} shadowMapSize={quality.shadowMapSize} />
        </Suspense>
        {/* El desenfoque del despertar baja los FPS: se mide solo después de la entrada. */}
        {phase !== "intro" && <PerformanceMonitor onDecline={declineQuality} />}
      </Canvas>
      </motion.div>

      {/* Fundido a negro al caer por el agujero (Player maneja su opacidad). */}
      <div ref={fadeRef} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} />

      {/* Mientras carga: ojos cerrados con una luz tenue que se cuela por los párpados. */}
      <DrowsyLight visible={!awake} />
      {/* Encima de la luz: los párpados (somnolientos mientras carga y luego el despertar). */}
      <WakeEyelids active={phase === "intro"} started={awake} />

      {phase === "playing" && <Crosshair />}
      {phase === "playing" && <TargetHint light={theme === "light"} />}

      <AnimatePresence>
        {phase === "writing" && draftSpot && (
          <EchoComposer key="composer" spot={draftSpot} onClose={stopWriting} />
        )}
      </AnimatePresence>

      {/* Menú de pausa (Esc): atajos, controles y Continuar. */}
      <AnimatePresence>
        {phase === "paused" && (
          <motion.div
            key="pause"
            className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="w-[min(420px,90vw)] rounded-2xl border border-white/10 bg-[#1c1c1c]/95 p-8 text-center text-white shadow-2xl">
              <h2 className="text-2xl font-black uppercase tracking-wide">{t("paused")}</h2>
              <p className="mt-5 text-left text-xs font-semibold uppercase tracking-widest text-white/40">{t("shortcuts.title")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Shortcut icon={Home} label={t("shortcuts.home")} onClick={() => warp("home")} />
                <Shortcut icon={Cloud} label={t("shortcuts.cloudhall")} onClick={() => warp("cloudhall")} />
                <Shortcut icon={Waves} label={t("shortcuts.poolrooms")} onClick={() => warp("poolrooms")} />
                <Shortcut
                  icon={theme === "dark" ? SunIcon : Moon}
                  label={theme === "dark" ? t("actions.toLight") : t("actions.toDark")}
                  onClick={toggleTheme}
                />
                <Shortcut
                  icon={Languages}
                  label={language === "es" ? t("actions.english") : t("actions.spanish")}
                  onClick={() => void setLanguage(language === "es" ? "en" : "es")}
                />
              </div>
              <ControlsList className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-left text-sm text-white/80" />
              <button
                onClick={lock}
                className="mt-7 w-full rounded-lg bg-white py-3 font-bold uppercase tracking-wider text-black transition hover:scale-[1.02] hover:bg-yellow-400"
              >
                {t("resume")}
              </button>
              <p className="mt-3 text-xs text-white/40">{t("pauseHint")}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {phase !== "intro" && phase !== "paused" && phase !== "writing" && (
        <div
          className={`pointer-events-none absolute bottom-6 left-6 flex flex-col items-start gap-3 ${
            theme === "light" ? "text-zinc-800" : "text-white"
          }`}
        >
          <AnimatePresence>
            {showHelp && (
              <motion.div
                className="flex flex-col items-start gap-3"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2 }}
              >
                <BackendStatus status={backend} light={theme === "light"} />
                <ControlsList
                  className={`flex flex-col gap-1.5 text-sm ${
                    theme === "light" ? "text-zinc-800" : "text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]"
                  }`}
                />
                <SignaturesHelp light={theme === "light"} />
              </motion.div>
            )}
          </AnimatePresence>
          <div
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ${
              theme === "light" ? "text-zinc-600" : "text-white/70 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]"
            }`}
          >
            <span className="flex items-center gap-2">
              <Kbd>F</Kbd>
              {showHelp ? t("hud.hidePanel") : t("hud.showPanel")}
            </span>
            <span className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              {t("controls.pause")}
            </span>
            {phase === "ready" && <span>{t("clickToExplore")}</span>}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Botón de atajo del menú de pausa. */
function Shortcut({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm font-semibold text-white/85 transition hover:border-yellow-400/60 hover:bg-white/10"
    >
      <Icon className="h-4 w-4 shrink-0 text-yellow-400" aria-hidden />
      <span className="leading-tight">{label}</span>
    </button>
  );
}

// Mira: un punto que crece un poco cuando lo que se mira se puede usar (E o click).
function Crosshair() {
  const hasAction = useTargetHasAction();
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className={`h-1.5 w-1.5 rounded-full bg-white/80 shadow-[0_0_6px_rgba(0,0,0,0.6)] transition-transform duration-150 ${
          hasAction ? "scale-[1.8]" : "scale-100"
        }`}
      />
    </div>
  );
}

/** Debajo de la mira: qué hace E con lo que se está mirando (p. ej. un eco). */
function TargetHint({ light }: { light: boolean }) {
  const label = useSyncExternalStore(targetStore.subscribe, () => targetStore.get()?.label);
  if (!label) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 mt-6 flex justify-center">
      <span
        className={`flex items-center gap-2 text-xs ${
          light ? "text-zinc-700" : "text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]"
        }`}
      >
        <Kbd>E</Kbd>
        {label}
      </span>
    </div>
  );
}

/** Cuadro para escribir un eco: Enter lo deja, Esc cancela. */
function EchoComposer({ spot, onClose }: { spot: EchoSpot; onClose: () => void }) {
  const { t } = useTranslation("world3d");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const texto = text.trim();
    if (!texto || sending) return;
    setSending(true);
    setError(null);
    const failure = await createEcho({ texto, ...spot });
    setSending(false);
    if (failure) setError(failure === "network" ? t("echoes.networkError") : failure);
    else onClose();
  };

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <form
        className="w-[min(440px,90vw)] rounded-2xl border border-white/10 bg-[#1c1c1c]/95 p-6 text-white shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-lg font-black uppercase tracking-wide">{t("echoes.title")}</h2>
        <p className="mt-1 text-xs text-white/50">{t("echoes.hint")}</p>
        <textarea
          autoFocus
          rows={3}
          maxLength={ECHO_MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={t("echoes.placeholder")}
          className="mt-4 w-full resize-none rounded-lg border border-white/15 bg-black/40 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-yellow-400/60"
        />
        <div className="mt-1 flex justify-between text-xs text-white/40">
          <span className="text-red-400">{error}</span>
          <span>
            {text.length}/{ECHO_MAX_LENGTH}
          </span>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-white/15 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/10"
          >
            {t("echoes.cancel")}
          </button>
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="flex-1 rounded-lg bg-white py-2.5 text-sm font-bold uppercase tracking-wider text-black transition hover:bg-yellow-400 disabled:opacity-40"
          >
            {sending ? t("echoes.sending") : t("echoes.send")}
          </button>
        </div>
      </form>
    </motion.div>
  );
}

function ControlsList({ className }: { className: string }) {
  const { t } = useTranslation("world3d");
  return (
    <ul className={className}>
      <li className="flex items-center gap-2"><Kbd>WASD</Kbd>{t("controls.move")}</li>
      <li className="flex items-center gap-2"><Kbd>🖱</Kbd>{t("controls.look")}</li>
      <li className="flex items-center gap-2"><Kbd>Shift</Kbd>{t("controls.run")}</li>
      <li className="flex items-center gap-2"><Kbd>{t("controls.spaceKey")}</Kbd>{t("controls.jump")}</li>
      <li className="flex items-center gap-2"><Kbd>E</Kbd>{t("controls.interact")}</li>
      <li className="flex items-center gap-2"><Kbd>N</Kbd>{t("controls.echo")}</li>
      <li className="flex items-center gap-2"><Kbd>F</Kbd>{t("controls.help")}</li>
      <li className="flex items-center gap-2"><Kbd>Esc</Kbd>{t("controls.pause")}</li>
    </ul>
  );
}

/** En el panel de la F: cómo se deja una firma (eco) y cómo se responde a una. */
function SignaturesHelp({ light }: { light: boolean }) {
  const { t } = useTranslation("world3d");
  const steps = [
    <><Kbd>N</Kbd>{t("signatures.step1")}</>,
    <><Kbd>Enter</Kbd>{t("signatures.step2", { max: ECHO_MAX_LENGTH })}</>,
    <><span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-200 shadow-[0_0_6px_#fde68a]" />{t("signatures.step3")}</>,
    <><Kbd>E</Kbd>{t("signatures.step4")}</>,
  ];
  return (
    <div
      className={`max-w-[min(340px,80vw)] rounded-xl border px-4 py-3 text-xs backdrop-blur-sm ${
        light ? "border-zinc-300/70 bg-white/70 text-zinc-800" : "border-white/10 bg-black/50 text-white/85"
      }`}
    >
      <p className="font-semibold uppercase tracking-widest opacity-60">{t("signatures.title")}</p>
      <ol className="mt-2 flex flex-col gap-1.5 leading-snug">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Párpados del despertar. Mientras carga la escena: somnolientos, se entreabren
 * apenas y vuelven a cerrarse (en lugar de una pantalla de carga). Cuando el mundo
 * está listo: dos parpadeos rápidos, una pausa y la apertura final, lenta.
 */
function WakeEyelids({ active, started }: { active: boolean; started: boolean }) {
  const lid = (from: "top" | "bottom") => (
    <motion.div
      className="absolute left-[-10%] h-[56%] w-[120%] bg-black"
      style={{
        [from]: 0,
        transformOrigin: from,
        // Borde curvo, como un párpado.
        borderRadius: from === "top" ? "0 0 50% 50% / 0 0 38% 38%" : "50% 50% 0 0 / 38% 38% 0 0",
        boxShadow: from === "top" ? "0 30px 60px 30px rgba(0,0,0,0.85)" : "0 -30px 60px 30px rgba(0,0,0,0.85)",
      }}
      initial={{ scaleY: 1 }}
      animate={started ? { scaleY: WAKE_LIDS } : { scaleY: [1, 1, 0.86, 1, 1, 0.92, 0.8, 1] }}
      transition={
        started
          ? {
              duration: WAKE_SECONDS,
              times: WAKE_TIMES,
              // Parpadeos secos y apertura final suave.
              ease: ["easeOut", "easeIn", "easeOut", "easeIn", "linear", "easeInOut"],
            }
          : { duration: 3.2, times: [0, 0.3, 0.38, 0.48, 0.66, 0.72, 0.8, 0.92], ease: "easeInOut", repeat: Infinity }
      }
    />
  );
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="eyelids"
          className="pointer-events-none absolute inset-0 overflow-hidden"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {lid("top")}
          {lid("bottom")}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded border border-white/30 bg-black/60 px-1.5 py-0.5 font-mono text-xs text-white backdrop-blur-sm">
      {children}
    </kbd>
  );
}

/**
 * Lo que se ve con los ojos cerrados mientras carga el mundo: oscuridad con una luz
 * tenue y borrosa que palpita, como la que se cuela por los párpados al despertar.
 * Desaparece cuando la escena está lista (debajo ya está el mundo).
 */
function DrowsyLight({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="drowsy"
          className="pointer-events-none absolute inset-0 bg-black"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.05 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse 60% 22% at 50% 50%, #3a3a44 0%, #15151a 45%, #000 80%)", filter: "blur(18px)" }}
            animate={{ opacity: [0.35, 0.7, 0.4, 0.75, 0.35] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
