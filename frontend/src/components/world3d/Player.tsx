// ==========================================
// Player.tsx - JUGADOR EN PRIMERA PERSONA
// ==========================================
// - Entrada "despertar": el jugador empieza casi en el suelo mirando al cielo,
//   ladeado, y se incorpora hasta la altura de los ojos mirando al prado (los párpados
//   y la visión borrosa los dibuja World3D por encima del Canvas).
// - Movimiento con WASD / flechas (Shift para correr). Se camina por el prado dentro
//   del límite (isWalkable) y se choca con casas, cercas y paredes.
// - Niveles: los escalones bajos se suben y bajan solos; Espacio
//   salta y la gravedad devuelve al suelo.
// - Mirada con el ratón (pointer lock).
// - Detecta qué objeto está en el centro de la pantalla y lo usa con E o click.
// - Al caer por el agujero se funde a negro y se aparece en los Backrooms (NOCLIP).

import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { targetStore, type Collider, type Interactable } from "./shared";
import {
  GRASS_Y,
  SPAWN as SPAWN_XZ,
  SPAWN_LOOK,
  WARPS,
  groundHeight,
  isWalkable,
  type WarpId,
} from "./worldMap";
import { HEAD_HEIGHT, NOCLIP, REMOTE_X_MIN, interiorCeiling, loopShift, portalCross } from "./interiorMaps";

/** Al llegar a los Backrooms: segundos en negro y segundos que tarda en volver la imagen. */
const NOCLIP_HOLD = 0.45;
const NOCLIP_REVEAL = 1.6;

const EYE = 1.65; // altura de los ojos sobre los pies
const EYE_HEIGHT = GRASS_Y + EYE;
const STEP_UP = 0.45; // escalón máximo que se sube caminando
const JUMP_SPEED = 7.2; // ≈ 1,35 m de salto
const GRAVITY = 19;
const RADIUS = 0.35;
const WALK_SPEED = 3.2;
const RUN_SPEED = 5.8;
const INTERACT_DISTANCE = 6;
/** Duración del despertar (debe coincidir con WAKE_SECONDS de World3D). */
export const INTRO_SECONDS = 3.2;

const SPAWN = new THREE.Vector3(SPAWN_XZ.x, EYE_HEIGHT, SPAWN_XZ.z);
// Tumbado en el suelo, un poco detrás del punto de inicio, mirando al cielo.
const INTRO_FROM = new THREE.Vector3(SPAWN_XZ.x, GRASS_Y + 0.45, SPAWN_XZ.z + 0.7);
const LOOK_FROM = new THREE.Vector3(SPAWN_XZ.x + 1.2, GRASS_Y + 9, SPAWN_XZ.z - 1.5);
const INTRO_ROLL = 0.35; // cabeza ladeada al despertar
const LOOK_TO = new THREE.Vector3(SPAWN_LOOK.x, EYE_HEIGHT + 0.6, SPAWN_LOOK.z);

interface PlayerProps {
  controlsRef: MutableRefObject<PointerLockControlsImpl | null>;
  /** Se leen en cada frame: se pueden activar/desactivar sin re-renderizar. */
  colliders: Collider[];
  onLockChange: (locked: boolean) => void;
  onIntroDone: () => void;
  /** Se llama cuando empieza el despertar (la escena ya cargó). */
  onIntroStart?: () => void;
  /** Con el menú de pausa abierto el jugador no se mueve ni interactúa. */
  paused: boolean;
  /** Player deja aquí la función que lo traslada a un destino (atajos del menú de pausa). */
  warpRef?: MutableRefObject<((to: WarpId) => void) | null>;
  /** Capa negra encima del Canvas: el fundido al caer por el agujero. */
  fadeRef?: MutableRefObject<HTMLDivElement | null>;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export default function Player({ controlsRef, colliders, onLockChange, onIntroDone, onIntroStart, paused, warpRef, fadeRef }: PlayerProps) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const { camera, scene, gl } = useThree();
  // El despertar espera a que la escena dibuje fluido (ver más abajo).
  const smoothFrames = useRef(0);
  const waitedForWake = useRef(0);
  const wakeStarted = useRef(false);
  const keys = useRef<Record<string, boolean>>({});
  const intro = useRef(0);
  const introDone = useRef(false);
  const raycaster = useRef(new THREE.Raycaster());
  const frame = useRef(0);
  const bob = useRef(0);
  // Altura de los pies y velocidad vertical (salto y caída).
  const feet = useRef(GRASS_Y);
  const velocityY = useRef(0);
  const jumpQueued = useRef(false);
  /** Segundos desde que se llegó a los Backrooms por el agujero (-1: no se está llegando). */
  const noclipIn = useRef(-1);

  // Posición inicial de la entrada.
  useEffect(() => {
    camera.position.copy(INTRO_FROM);
    camera.lookAt(LOOK_FROM);
    camera.rotateZ(INTRO_ROLL);
    // Compila los shaders de toda la escena ya, para que no traben el despertar.
    try {
      gl.compile(scene, camera);
    } catch {
      // Si falla, se compilan al dibujar (como siempre).
    }
  }, [camera, gl, scene]);

  // Atajo del menú de pausa: aparece de pie en el destino, mirando hacia su objetivo.
  useEffect(() => {
    if (!warpRef) return;
    warpRef.current = (to) => {
      if (!introDone.current) return;
      const { x, z, look } = WARPS[to];
      feet.current = groundHeight(x, z);
      velocityY.current = 0;
      jumpQueued.current = false;
      noclipIn.current = -1;
      if (fadeRef?.current) fadeRef.current.style.opacity = "0";
      keys.current = {};
      camera.position.set(x, feet.current + EYE, z);
      camera.lookAt(look.x, feet.current + EYE, look.z);
      before.current.copy(camera.position);
    };
    return () => {
      warpRef.current = null;
    };
  }, [warpRef, camera, fadeRef]);

  // Teclado y click para moverse e interactuar.
  useEffect(() => {
    // E funciona siempre tras la entrada; el click solo con el ratón bloqueado
    // (sin bloquear, el click sirve para bloquearlo).
    const interact = () => {
      if (!introDone.current || pausedRef.current) return;
      targetStore.get()?.action?.();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === "KeyE" && !e.repeat) interact();
      if (e.code === "Space" && !e.repeat && introDone.current && !pausedRef.current) {
        e.preventDefault();
        jumpQueued.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && controlsRef.current?.isLocked) interact();
    };
    // Al perder el foco se sueltan todas las teclas (evita que el jugador siga caminando solo).
    const onBlur = () => {
      keys.current = {};
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [controlsRef]);

  const collides = (x: number, z: number) => {
    if (!isWalkable(x, z, RADIUS)) return true;
    // Un nivel más alto que un escalón solo se alcanza saltando.
    const ground = groundHeight(x, z);
    if (ground - feet.current > STEP_UP) return true;
    // Bajo un techo no se sube si la cabeza no cabe (la escalera que se mete en el techo).
    const ceiling = interiorCeiling(x, z);
    if (ceiling !== null && ground + HEAD_HEIGHT > ceiling) return true;
    return colliders.some((c) => {
      // Con rango de altura: si los pies quedan por encima o la cabeza por debajo, no choca.
      if (c.maxY !== undefined && feet.current > c.maxY - STEP_UP) return false;
      if (c.minY !== undefined && feet.current + HEAD_HEIGHT < c.minY) return false;
      if (c.circle) return Math.hypot(x - c.circle.x, z - c.circle.z) < c.circle.r + RADIUS;
      return x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ;
    });
  };

  const forward = useRef(new THREE.Vector3());
  /** Posición al empezar el frame (para detectar el cruce de un umbral). */
  const before = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);

    // --- Despertar ---
    // Empieza cuando la escena lleva unos fotogramas fluidos: el primer dibujado (texturas,
    // shaders) puede trabar la página y, como los párpados van por reloj, se perderían
    // los parpadeos. Mientras tanto siguen los párpados somnolientos de World3D.
    if (!wakeStarted.current) {
      smoothFrames.current = rawDelta < 0.1 ? smoothFrames.current + 1 : 0;
      waitedForWake.current += Math.min(rawDelta, 0.5);
      // En equipos muy lentos (que nunca van fluido) empieza igual a los 4 s.
      if (smoothFrames.current >= 6 || waitedForWake.current > 4) {
        wakeStarted.current = true;
        onIntroStart?.();
      }
      return;
    }
    if (!introDone.current) {
      // Tiempo real (no el delta recortado): así va sincronizado con los párpados y el
      // desenfoque de World3D aunque el equipo dé pocos FPS.
      intro.current = Math.min(1, intro.current + Math.min(rawDelta, 0.25) / INTRO_SECONDS);
      // Tumbado durante los dos parpadeos; se incorpora con la apertura final (lenta).
      const rise = easeInOut(THREE.MathUtils.clamp((intro.current - 0.38) / 0.6, 0, 1));
      camera.position.lerpVectors(INTRO_FROM, SPAWN, easeOut(rise));
      look.current.lerpVectors(LOOK_FROM, LOOK_TO, rise);
      camera.lookAt(look.current);
      // Ladeo de la cabeza que se endereza al incorporarse.
      camera.rotateZ(INTRO_ROLL * (1 - rise));
      if (intro.current >= 1) {
        introDone.current = true;
        onIntroDone();
      }
      return;
    }

    // --- Movimiento (no exige el ratón bloqueado: se puede caminar desde que termina la entrada) ---
    if (!pausedRef.current) {
      const k = keys.current;
      const ahead = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      const side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);

      camera.getWorldDirection(forward.current);
      forward.current.y = 0;
      forward.current.normalize();
      right.current.crossVectors(forward.current, camera.up).normalize();

      move.current
        .set(0, 0, 0)
        .addScaledVector(forward.current, ahead)
        .addScaledVector(right.current, side);

      if (move.current.lengthSq() > 0) {
        const speed = k.ShiftLeft || k.ShiftRight ? RUN_SPEED : WALK_SPEED;
        move.current.normalize().multiplyScalar(speed * delta);
        // Se prueba cada eje por separado para poder deslizarse junto a las paredes.
        const nx = camera.position.x + move.current.x;
        if (!collides(nx, camera.position.z)) camera.position.x = nx;
        const nz = camera.position.z + move.current.z;
        if (!collides(camera.position.x, nz)) camera.position.z = nz;
        bob.current += delta * speed * 2.2;
      }
    }
    // --- Portales de las casas más grandes por dentro (y pasillos infinitos) ---
    // Al cruzar un umbral (o el disparador de un pasillo infinito) se mueve la cámara y
    // los pies a la posición equivalente del otro lado, que se ve idéntica.
    const shift = portalCross(before.current, camera.position) ?? loopShift(camera.position);
    before.current.copy(camera.position);
    if (shift) {
      camera.position.add(shift);
      before.current.add(shift);
      feet.current += shift.y;
    }
    // --- Altura: salto, gravedad y escalones ---
    const ground = groundHeight(camera.position.x, camera.position.z);
    const grounded = feet.current <= ground + 0.01 && velocityY.current <= 0;
    if (jumpQueued.current && grounded) velocityY.current = JUMP_SPEED;
    jumpQueued.current = false;
    if (feet.current < ground) {
      // Escalón hacia arriba: se sube suave, sin saltos de cámara.
      feet.current = Math.min(ground, feet.current + Math.max(ground - feet.current, 0.02) * Math.min(1, delta * 14));
      if (ground - feet.current < 0.005) feet.current = ground;
      velocityY.current = Math.max(velocityY.current, 0);
    }
    if (velocityY.current !== 0 || feet.current > ground) {
      velocityY.current -= GRAVITY * delta;
      feet.current += velocityY.current * delta;
      if (feet.current <= ground) {
        feet.current = ground;
        velocityY.current = 0;
      }
    }
    // Techo de los interiores: la cabeza choca con el cielo raso (no se lo atraviesa saltando).
    const ceiling = interiorCeiling(camera.position.x, camera.position.z);
    if (ceiling !== null && feet.current + HEAD_HEIGHT > ceiling) {
      feet.current = Math.max(ground, ceiling - HEAD_HEIGHT);
      velocityY.current = Math.min(velocityY.current, 0);
    }
    // --- Caída por el agujero: a los Backrooms ---
    // Al bajar se funde a negro; abajo del todo, el jugador aparece cayendo en la sala de
    // pilares (como quien atraviesa el suelo) y la imagen vuelve de a poco.
    const overlay = fadeRef?.current;
    if (noclipIn.current >= 0) {
      noclipIn.current += Math.min(rawDelta, 0.1);
      const t = noclipIn.current;
      if (overlay) overlay.style.opacity = String(t < NOCLIP_HOLD ? 1 : 1 - THREE.MathUtils.smoothstep(t, NOCLIP_HOLD, NOCLIP_HOLD + NOCLIP_REVEAL));
      if (t > NOCLIP_HOLD + NOCLIP_REVEAL) noclipIn.current = -1;
    } else if (camera.position.x < REMOTE_X_MIN && feet.current < NOCLIP.fadeFrom) {
      const k = THREE.MathUtils.clamp((NOCLIP.fadeFrom - feet.current) / (NOCLIP.fadeFrom - NOCLIP.teleportAt), 0, 1);
      if (overlay) overlay.style.opacity = String(k);
      if (k >= 1) {
        // Un poco en el aire, bajo el techo: cae al piso y aterriza.
        feet.current = NOCLIP.to.y + 0.85;
        velocityY.current = -1.5;
        camera.position.set(NOCLIP.to.x, feet.current + EYE, NOCLIP.to.z);
        camera.lookAt(NOCLIP.look.x, feet.current + EYE, NOCLIP.look.z);
        before.current.copy(camera.position);
        noclipIn.current = 0;
        return;
      }
    } else if (overlay && overlay.style.opacity !== "0") {
      overlay.style.opacity = "0";
    }

    // Balanceo suave de la cabeza al caminar (solo con los pies en el suelo).
    const onGround = feet.current <= ground + 0.01;
    camera.position.y = feet.current + EYE + (onGround ? Math.sin(bob.current) * 0.035 : 0);

    // --- Objetivo en el centro de la pantalla (cada 3 frames) ---
    frame.current = (frame.current + 1) % 3;
    if (frame.current !== 0) return;
    let found: Interactable | null = null;
    {
      raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
      raycaster.current.far = INTERACT_DISTANCE;
      const hits = raycaster.current.intersectObjects(scene.children, true);
      // Solo cuenta lo primero que se ve: una pared tapa lo que haya detrás.
      let obj: THREE.Object3D | null = hits[0]?.object ?? null;
      while (obj && !obj.userData?.interactable) obj = obj.parent;
      if (obj) found = obj.userData.interactable as Interactable;
    }
    // Siempre se guarda el objeto más reciente (su acción puede depender del estado actual,
    // p. ej. la tele que se apaga); la interfaz solo se avisa si cambia lo que muestra.
    const previous = targetStore.get();
    targetStore.set(found, found?.id !== previous?.id || found?.label !== previous?.label);
  });

  return (
    <PointerLockControls
      ref={controlsRef}
      // El bloqueo del ratón se pide a mano (click en el mundo o Enter, ver World3D).
      // Este selector no existe a propósito: sin él, drei bloquearía con cualquier click.
      selector="#world3d-manual-lock"
      onLock={() => onLockChange(true)}
      onUnlock={() => {
        keys.current = {};
        targetStore.set(null);
        onLockChange(false);
      }}
    />
  );
}
