// ==========================================
// Oddities.tsx - RAREZAS SUELTAS EN EL PRADO
// ==========================================
// Objetos fuera de lugar para encontrar explorando (posiciones en liminal.ts):
//
// - El cartel "Santiago estuvo aquí", pintado a mano, frente al punto de aparición.
// - Una sala de estar en medio del pasto con la tele encendida en estática. Con E se
//   apaga... y al rato se vuelve a encender sola.
// - Columpios que se mecen sin nadie y sin viento.
// - Una máquina expendedora encendida, sola.
// - Un teléfono público que suena cuando alguien se acerca. Con E se contesta.
// - Una piscina de agua quieta en medio del prado, con su escalera.
// - Un letrero de SALIDA encendido que no lleva a ningún lado.
//
// Cada rareza es un grupo en su lugar con una malla maciza (colores por vértice, se
// oscurece de noche como las casas) y, si brilla, otra que no se oscurece: de noche
// las pantallas y letreros se ven encendidos.

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { at, box, painted } from "./geometryKit";
import { UIText, type Interactable } from "./shared";
import { NIGHT_TINT } from "./worldMaterials";
import { EXIT_SIGN, LIVING_ROOM, PAYPHONE, POOL, SANTIAGO_SIGN, SWINGS, VENDING, terrainHeight } from "./liminal";

type BlendRef = MutableRefObject<number>;
type Placement = { x: number; z: number; rotation: number };

const WHITE = new THREE.Color("#ffffff");
/** De día lo que brilla se ve apagado; de noche, encendido. */
const GLOW_DAY = new THREE.Color("#b8b8b8");

const rotX = (a: number) => new THREE.Matrix4().makeRotationX(a);
const rotY = (a: number) => new THREE.Matrix4().makeRotationY(a);
const rotZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const cylinder = (rTop: number, rBottom: number, h: number, seg = 10) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

/** Une piezas (ya pintadas y colocadas) en una sola geometría. */
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

// --- Materiales compartidos ---

const solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const waterMaterial = new THREE.MeshStandardMaterial({ color: "#5cc3df", roughness: 0.08, metalness: 0.15 });
const WATER_DAY = new THREE.Color("#5cc3df");
const WATER_NIGHT = new THREE.Color("#163447");

export default function Oddities({ blend, animated }: { blend: BlendRef; animated: boolean }) {
  useFrame(() => {
    const night = 1 - blend.current;
    solidMaterial.color.copy(WHITE).lerp(NIGHT_TINT, night);
    glowMaterial.color.copy(GLOW_DAY).lerp(WHITE, night);
    waterMaterial.color.copy(WATER_DAY).lerp(WATER_NIGHT, night);
  });

  return (
    <group>
      <SantiagoSign />
      <LivingRoom animated={animated} />
      <Swings animated={animated} />
      <VendingMachine />
      <Payphone animated={animated} />
      <Pool />
      <ExitSign />
    </group>
  );
}

/** Grupo en el lugar de una rareza, apoyado en el terreno. */
function Placed({ at: o, tilt = 0, children }: { at: Placement; tilt?: number; children: ReactNode }) {
  return (
    <group position={[o.x, terrainHeight(o.x, o.z), o.z]} rotation={[0, o.rotation, tilt]}>
      {children}
    </group>
  );
}

function Solid({ geometry }: { geometry: THREE.BufferGeometry }) {
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={solidMaterial} castShadow receiveShadow />;
}

function Glow({ geometry }: { geometry: THREE.BufferGeometry }) {
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={glowMaterial} raycast={() => null} />;
}

// ==========================================
// "Santiago estuvo aquí"
// ==========================================

function SantiagoSign() {
  const geometry = useMemo(
    () =>
      merge([
        painted(box(0.1, 1.7, 0.1), "#6b4a2f", at(-0.8, 0.85, -0.02)),
        painted(box(0.1, 1.55, 0.1), "#6b4a2f", at(0.8, 0.78, -0.02)),
        painted(box(1.9, 0.78, 0.06), "#c49a6c", at(0, 1.3, 0.04)),
        // Tablas: una franja más oscura entre ellas.
        painted(box(1.9, 0.02, 0.062), "#8a6544", at(0, 1.3, 0.04)),
      ]),
    []
  );
  return (
    <Placed at={SANTIAGO_SIGN} tilt={0.035}>
      <Solid geometry={geometry} />
      <Suspense fallback={null}>
        {/* Pintado a mano: un poco torcido. */}
        <group position={[0, 0, 0.075]} rotation={[0, 0, -0.03]}>
          <UIText weight={900} size={0.25} color="#3a2416" position={[0, 1.42, 0]}>
            Santiago
          </UIText>
          <UIText weight={700} size={0.15} color="#3a2416" position={[0.05, 1.17, 0]}>
            estuvo aquí
          </UIText>
        </group>
      </Suspense>
    </Placed>
  );
}

// ==========================================
// Sala de estar con la tele encendida
// ==========================================

const staticVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const staticFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOn;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float n = hash(floor(vUv * vec2(96.0, 72.0)) + floor(uTime * 24.0) * 7.31);
    float scan = 0.82 + 0.18 * sin(vUv.y * 340.0 + uTime * 12.0);
    // Bordes más oscuros, como una pantalla curva de tubo.
    vec2 c = vUv - 0.5;
    float vignette = 1.0 - dot(c, c) * 1.6;
    vec3 col = vec3(n * scan * vignette) * vec3(0.86, 0.92, 1.0);
    gl_FragColor = vec4(mix(vec3(0.015), col, uOn), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Segundos que la tele se queda apagada antes de encenderse sola. */
const TV_OFF_SECONDS = 4;

function LivingRoom({ animated }: { animated: boolean }) {
  const { t } = useTranslation("world3d");
  const { solid, glow } = useMemo(
    () => ({
      solid: merge([
        // Alfombra con borde.
        painted(box(3.2, 0.015, 2.8), "#c8a24a", at(0, 0.008, 0)),
        painted(box(2.9, 0.02, 2.5), "#7a3b33", at(0, 0.012, 0)),
        // Sofá mirando a la tele.
        painted(box(2, 0.42, 0.85), "#c9b79c", at(0, 0.21, 1.2)),
        painted(box(2, 0.6, 0.2), "#bfae92", at(0, 0.62, 1.55)),
        painted(box(0.2, 0.62, 0.85), "#bfae92", at(-0.95, 0.31, 1.2)),
        painted(box(0.2, 0.62, 0.85), "#bfae92", at(0.95, 0.31, 1.2)),
        painted(box(0.55, 0.12, 0.6), "#d6c6ab", at(-0.42, 0.48, 1.12)),
        painted(box(0.55, 0.12, 0.6), "#d6c6ab", at(0.42, 0.48, 1.12)),
        // Mesita.
        painted(box(0.9, 0.06, 0.5), "#6b4a35", at(0, 0.38, 0)),
        ...[-0.38, 0.38].flatMap((x) => [-0.18, 0.18].map((z) => painted(box(0.05, 0.36, 0.05), "#5a3e2c", at(x, 0.18, z)))),
        // Mueble y tele de tubo, con sus antenas.
        painted(box(1.4, 0.5, 0.45), "#5b4030", at(0, 0.25, -1.3)),
        painted(box(0.82, 0.62, 0.55), "#2b2b2b", at(0, 0.81, -1.3)),
        painted(box(0.02, 0.5, 0.02), "#9a9a9a", rotZ(0.45).premultiply(at(-0.1, 1.33, -1.35))),
        painted(box(0.02, 0.5, 0.02), "#9a9a9a", rotZ(-0.45).premultiply(at(0.1, 1.33, -1.35))),
        // Lámpara de pie.
        painted(cylinder(0.14, 0.18, 0.03, 14), "#3a3a3a", at(1.3, 0.015, 1.6)),
        painted(cylinder(0.02, 0.02, 1.45), "#3a3a3a", at(1.3, 0.74, 1.6)),
      ]),
      glow: merge([painted(cylinder(0.13, 0.22, 0.3, 14), "#f5e3b8", at(1.3, 1.55, 1.6))]),
    }),
    []
  );

  const screenMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: staticVertex,
        fragmentShader: staticFragment,
        uniforms: { uTime: { value: 0 }, uOn: { value: 1 } },
      }),
    []
  );
  useEffect(() => () => screenMaterial.dispose(), [screenMaterial]);

  const [on, setOn] = useState(true);
  const offTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(offTimer.current), []);
  const interactable = useMemo<Interactable>(
    () =>
      on
        ? {
            id: "tv",
            label: t("oddities.tvOff"),
            action: () => {
              setOn(false);
              clearTimeout(offTimer.current);
              offTimer.current = setTimeout(() => setOn(true), TV_OFF_SECONDS * 1000);
            },
          }
        : { id: "tv" },
    [on, t]
  );

  useFrame(({ clock }, delta) => {
    const u = screenMaterial.uniforms;
    if (animated) u.uTime.value = clock.elapsedTime;
    // Al volver a encenderse, parpadea un poco antes de quedarse fija.
    const target = on ? (u.uOn.value < 0.9 && Math.random() < 0.3 ? 0.2 : 1) : 0;
    u.uOn.value += (target - u.uOn.value) * Math.min(1, delta * (on ? 6 : 20));
  });

  return (
    <Placed at={LIVING_ROOM}>
      <Solid geometry={solid} />
      <Glow geometry={glow} />
      <group userData={{ interactable }}>
        {/* Zona invisible para apuntarle a la tele (el cuerpo ya está en la malla maciza). */}
        <mesh position={[0, 0.81, -1.3]}>
          <boxGeometry args={[0.86, 0.66, 0.59]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.82, -1.3 + 0.278]} material={screenMaterial} raycast={() => null}>
          <planeGeometry args={[0.62, 0.46]} />
        </mesh>
      </group>
    </Placed>
  );
}

// ==========================================
// Columpios que se mecen solos
// ==========================================

const BAR_HEIGHT = 2.3;
const CHAIN = 1.8;

function Swings({ animated }: { animated: boolean }) {
  const { frame, seat } = useMemo(() => {
    const legTilt = Math.atan2(0.8, BAR_HEIGHT);
    const legLength = Math.hypot(0.8, BAR_HEIGHT);
    const legs = [-1.6, 1.6].flatMap((x) =>
      [-1, 1].map((side) =>
        painted(box(0.07, legLength, 0.07), "#b9443a", rotX(-side * legTilt).premultiply(at(x, BAR_HEIGHT / 2, (side * 0.8) / 2)))
      )
    );
    return {
      frame: merge([...legs, painted(box(3.45, 0.09, 0.09), "#b9443a", at(0, BAR_HEIGHT, 0))]),
      // Un columpio: dos cadenas y el asiento, colgando del travesaño (origen en el eje).
      seat: merge([
        painted(box(0.02, CHAIN, 0.02), "#9aa3ab", at(-0.22, -CHAIN / 2, 0)),
        painted(box(0.02, CHAIN, 0.02), "#9aa3ab", at(0.22, -CHAIN / 2, 0)),
        painted(box(0.52, 0.04, 0.2), "#2d2d2d", at(0, -CHAIN, 0)),
      ]),
    };
  }, []);
  useEffect(() => () => seat.dispose(), [seat]);

  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!animated) return;
    const t = clock.elapsedTime;
    // Uno más alto que el otro, desfasados: como si alguien acabara de bajarse.
    if (left.current) left.current.rotation.x = Math.sin(t * 1.75) * 0.42;
    if (right.current) right.current.rotation.x = Math.sin(t * 1.75 + 2.1) * 0.22;
  });

  return (
    <Placed at={SWINGS}>
      <Solid geometry={frame} />
      <group ref={left} position={[-0.75, BAR_HEIGHT, 0]}>
        <mesh geometry={seat} material={solidMaterial} castShadow />
      </group>
      <group ref={right} position={[0.75, BAR_HEIGHT, 0]}>
        <mesh geometry={seat} material={solidMaterial} castShadow />
      </group>
    </Placed>
  );
}

// ==========================================
// Máquina expendedora
// ==========================================

const PRODUCTS = ["#e94f4f", "#f2b632", "#3f8fd9", "#4dbb6b", "#f07b2f", "#a75ad1"];

function VendingMachine() {
  const { solid, glow } = useMemo(() => {
    const items: THREE.BufferGeometry[] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        const color = PRODUCTS[(row * 3 + col * 5) % PRODUCTS.length];
        items.push(painted(box(0.1, 0.15, 0.02), color, at(-0.33 + col * 0.14, 0.72 + row * 0.22, 0.418)));
      }
    }
    return {
      solid: merge([
        painted(box(1, 1.9, 0.8), "#b8322a", at(0, 0.95, 0)),
        painted(box(0.22, 0.62, 0.02), "#2a2a2a", at(0.33, 1.2, 0.405)),
        painted(box(0.08, 0.12, 0.02), "#c8c8c8", at(0.33, 1.38, 0.418)),
        painted(box(0.6, 0.2, 0.02), "#111111", at(-0.12, 0.32, 0.405)),
      ]),
      glow: merge([
        painted(box(0.64, 1.18, 0.02), "#eaf6ff", at(-0.12, 1.15, 0.405)),
        painted(box(0.92, 0.14, 0.02), "#ffd36b", at(0, 1.8, 0.405)),
        ...items,
      ]),
    };
  }, []);
  return (
    <Placed at={VENDING}>
      <Solid geometry={solid} />
      <Glow geometry={glow} />
    </Placed>
  );
}

// ==========================================
// Teléfono público que suena
// ==========================================

/** Distancia a la que empieza a sonar. */
const RING_DISTANCE = 14;
/** Tras contestar, cuánto tarda en volver a sonar. */
const SILENCE_SECONDS = 25;

function Payphone({ animated }: { animated: boolean }) {
  const { t } = useTranslation("world3d");
  const { body, handset } = useMemo(
    () => ({
      body: merge([
        painted(box(0.1, 1.1, 0.1), "#6d6d6d", at(0, 0.55, 0)),
        painted(box(0.42, 0.62, 0.22), "#2f5d8a", at(0, 1.35, 0)),
        painted(box(0.16, 0.2, 0.012), "#c9c9c9", at(0.07, 1.3, 0.115)),
        painted(box(0.6, 0.05, 0.42), "#2f5d8a", at(0, 1.78, 0.06)),
        painted(box(0.02, 0.4, 0.02), "#1c1c1c", at(-0.14, 1.08, 0.13)),
      ]),
      handset: merge([
        painted(box(0.07, 0.3, 0.06), "#1c1c1c", at(0, 0, 0)),
        painted(box(0.1, 0.07, 0.08), "#1c1c1c", at(0, 0.15, 0.01)),
        painted(box(0.1, 0.07, 0.08), "#1c1c1c", at(0, -0.15, 0.01)),
      ]),
    }),
    []
  );
  useEffect(() => () => handset.dispose(), [handset]);

  const [answered, setAnswered] = useState(false);
  const silence = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(silence.current), []);
  const interactable = useMemo<Interactable>(
    () =>
      answered
        ? { id: "payphone", label: t("oddities.phoneVoice") }
        : {
            id: "payphone",
            label: t("oddities.phoneAnswer"),
            action: () => {
              setAnswered(true);
              clearTimeout(silence.current);
              silence.current = setTimeout(() => setAnswered(false), SILENCE_SECONDS * 1000);
            },
          },
    [answered, t]
  );

  const handsetRef = useRef<THREE.Mesh>(null);
  const position = useMemo(() => new THREE.Vector3(PAYPHONE.x, terrainHeight(PAYPHONE.x, PAYPHONE.z) + 1.4, PAYPHONE.z), []);
  useFrame(({ camera, clock }) => {
    if (!handsetRef.current) return;
    const t = clock.elapsedTime;
    // Suena en ráfagas (riiing... riiing) mientras alguien está cerca y no contestó.
    const ringing = animated && !answered && camera.position.distanceTo(position) < RING_DISTANCE && t % 2.6 < 1.1;
    handsetRef.current.rotation.z = ringing ? Math.sin(t * 70) * 0.06 : 0;
    handsetRef.current.position.y = 1.38 + (ringing ? Math.abs(Math.sin(t * 35)) * 0.012 : 0);
  });

  return (
    <Placed at={PAYPHONE}>
      <group userData={{ interactable }}>
        <Solid geometry={body} />
        <mesh ref={handsetRef} geometry={handset} material={solidMaterial} position={[-0.14, 1.38, 0.14]} castShadow />
      </group>
    </Placed>
  );
}

// ==========================================
// Piscina en el prado
// ==========================================

function Pool() {
  const { width: W, length: L } = POOL;
  const coping = useMemo(() => {
    const steel = "#cfd6db";
    // Escalera de piscina: barandas que salen del agua, se curvan sobre el borde y bajan.
    const rail = (x: number) => [
      painted(cylinder(0.025, 0.025, 1.0, 8), steel, at(x, 0.4, -L / 2 + 0.22)),
      painted(new THREE.TorusGeometry(0.17, 0.025, 6, 12, Math.PI), steel, rotY(Math.PI / 2).premultiply(at(x, 0.9, -L / 2 + 0.05))),
      painted(cylinder(0.025, 0.025, 0.75, 8), steel, at(x, 0.52, -L / 2 - 0.12)),
    ];
    const ladderX = W / 2 - 0.8;
    return merge([
      // Borde de baldosas blancas, un poco por encima del pasto.
      painted(box(W + 0.6, 0.1, 0.3), "#f2f4f5", at(0, 0.05, L / 2 + 0.15)),
      painted(box(W + 0.6, 0.1, 0.3), "#f2f4f5", at(0, 0.05, -L / 2 - 0.15)),
      painted(box(0.3, 0.1, L), "#f2f4f5", at(W / 2 + 0.15, 0.05, 0)),
      painted(box(0.3, 0.1, L), "#f2f4f5", at(-W / 2 - 0.15, 0.05, 0)),
      // Línea de azulejos azules justo bajo el borde.
      painted(box(W, 0.05, 0.06), "#2f7fae", at(0, 0.02, L / 2 - 0.03)),
      painted(box(W, 0.05, 0.06), "#2f7fae", at(0, 0.02, -L / 2 + 0.03)),
      ...rail(ladderX - 0.25),
      ...rail(ladderX + 0.25),
      painted(box(0.5, 0.03, 0.08), steel, at(ladderX, 0.25, -L / 2 + 0.22)),
    ]);
  }, [W, L]);

  return (
    <Placed at={POOL}>
      <Solid geometry={coping} />
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMaterial} receiveShadow>
        <planeGeometry args={[W, L]} />
      </mesh>
    </Placed>
  );
}

// ==========================================
// Letrero de SALIDA
// ==========================================

function ExitSign() {
  const { t } = useTranslation("world3d");
  const { solid, glow } = useMemo(
    () => ({
      solid: merge([
        painted(box(0.06, 2.2, 0.06), "#555555", at(0, 1.1, 0)),
        painted(box(0.95, 0.34, 0.1), "#e9e9e9", at(0, 2.35, 0)),
      ]),
      glow: merge([
        painted(box(0.85, 0.26, 0.01), "#1f9d55", at(0, 2.35, 0.051)),
        painted(box(0.85, 0.26, 0.01), "#1f9d55", at(0, 2.35, -0.051)),
      ]),
    }),
    []
  );
  return (
    <Placed at={EXIT_SIGN}>
      <Solid geometry={solid} />
      <Glow geometry={glow} />
      <Suspense fallback={null}>
        {[1, -1].map((side) => (
          <group key={side} position={[0, 2.35, side * 0.058]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
            <UIText weight={900} size={0.15} tracking={0.08}>
              {t("oddities.exit")}
            </UIText>
          </group>
        ))}
      </Suspense>
    </Placed>
  );
}
