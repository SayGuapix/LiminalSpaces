// ==========================================
// ThemeSky.tsx - CIELO Y ESCENA DEL MUNDO 3D
// ==========================================
// Cielo según el tema activo, el pasto (Grass.tsx), el prado liminal y los interiores.
//
// - Claro: cuadros grises que aparecen y se apagan en la cúpula del cielo.
// - Oscuro: rombos de "vidrio" y "polvo" flotando en el cielo y alrededor del jugador.
//
// Cambio de tema: los dos fondos están siempre montados y se funden con un valor
// de mezcla (0 = oscuro, 1 = claro) que avanza en TRANSITION_SECONDS. El color del
// cielo, el suelo, la luz ambiental, los rombos y los cuadros siguen esa mezcla.
//
// Neblina: del color del horizonte, oculta lo lejano y la cámara no dibuja mucho más
// allá (mejor rendimiento). Se abre con la altura: en la entrada desde lo alto se ve
// todo el mapa y se va cerrando al bajar a la altura de los ojos.
//
// Dentro de los interiores de las casas la neblina (la de three) pasa a ser la del
// interior: corta y del color de sus paredes, como en los Backrooms. Así los pasillos se
// pierden en la bruma y los infinitos no muestran su final. El cambio es inmediato: se
// entra por un portal que ya mostraba esa neblina. FOG (el desvanecido propio del pasto
// y las plataformas) sigue siendo el de afuera, y se guarda en OUTDOOR_FOG para el portal
// que mira al prado.
//
// Alrededor, el prado liminal (Meadow.tsx) con su cielo: azul de mediodía en claro y
// noche estrellada en oscuro. La cúpula del cielo (SkyDome) pinta el degradado.
//
// Con prefers-reduced-motion todo queda quieto y el cambio de tema es inmediato.

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import Grass from "./Grass";
import Meadow from "./Meadow";
import Interiors from "./Interiors";
import Portals from "./Portals";
import Oddities from "./Oddities";
import { OUTDOOR_FOG, indoorAt } from "./interiorMaps";
import { viewFollowers } from "./viewFollowers";
import { SKY } from "./liminal";

export interface ThemeSkyProps {
  theme: "light" | "dark";
  /** Animación base (false con prefers-reduced-motion). */
  animated: boolean;
  /** Equipo lento detectado: menos partículas. */
  lowPerformance: boolean;
  /** Briznas de pasto según el nivel de calidad (quality.ts). */
  grassBlades: number;
  /** Resolución de la vista por las puertas de las casas (quality.ts). */
  portalScale: number;
}

export const SKY_COLORS = {
  light: "#ffffff",
  dark: "#0a0a0c",
} as const;

const TRANSITION_SECONDS = 1.2;
// La neblina y el fondo toman el color del horizonte del cielo de cada tema.
const BG_DARK = new THREE.Color(SKY.night.horizon);
const BG_LIGHT = new THREE.Color(SKY.day.horizon);
const AMBIENT = { dark: 1.1, light: 1.4 };

/** Mezcla entre temas ya suavizada (0 = oscuro, 1 = claro). */
type BlendRef = MutableRefObject<number>;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Distancias de la neblina en este frame (las usa también el suelo, que tiene su propio shader). */
const FOG = { near: 9, far: 36 };
// Modo oscuro: noche despejada (sin neblina cercana) para ver el paisaje de lejos.
// Modo claro: bruma suave y lejana, de mediodía.
const FOG_AT_EYE = { dark: { near: 70, far: 260 }, light: { near: 60, far: 260 } };
/** La cámara dibuja al menos hasta aquí: las ventanas encendidas se ven a través de la neblina. */
const MIN_CAMERA_FAR = 140;
/** Por cada metro de altura de la cámara, la neblina se aleja esto. */
const FOG_PER_METER = 2.4;

export default function ThemeSky(props: ThemeSkyProps) {
  const { scene, camera } = useThree();
  const goal = props.theme === "light" ? 1 : 0;
  const progress = useRef(goal); // avance lineal
  const blend = useRef(goal); // avance suavizado, el que usan los demás
  const background = useMemo(() => BG_DARK.clone().lerp(BG_LIGHT, goal), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ambient = useRef<THREE.AmbientLight>(null);
  const indoorColors = useMemo(() => ({ day: new THREE.Color(), night: new THREE.Color() }), []);
  const fog = useMemo(() => new THREE.Fog(background.clone(), FOG.near, FOG.far), [background]);

  useEffect(() => {
    scene.background = background;
    scene.fog = fog;
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, background, fog]);

  // useFrame con prioridad negativa: corre antes que el suelo, los rombos y los cuadros.
  useFrame((_, delta) => {
    const step = props.animated ? delta / TRANSITION_SECONDS : 1;
    progress.current += THREE.MathUtils.clamp(goal - progress.current, -step, step);
    blend.current = smoothstep(progress.current);
    background.copy(BG_DARK).lerp(BG_LIGHT, blend.current);
    if (ambient.current) ambient.current.intensity = THREE.MathUtils.lerp(AMBIENT.dark, AMBIENT.light, blend.current);

    // Neblina según la altura de la cámara; la cámara no dibuja más allá de ella.
    const extra = Math.max(0, camera.position.y - 4) * FOG_PER_METER;
    FOG.near = THREE.MathUtils.lerp(FOG_AT_EYE.dark.near, FOG_AT_EYE.light.near, blend.current) + extra * 0.6;
    FOG.far = THREE.MathUtils.lerp(FOG_AT_EYE.dark.far, FOG_AT_EYE.light.far, blend.current) + extra;
    OUTDOOR_FOG.near = FOG.near;
    OUTDOOR_FOG.far = FOG.far;
    OUTDOOR_FOG.color.copy(background);
    // Neblina del interior, si la cámara está en uno.
    const inside = indoorAt(camera.position.x, camera.position.z);
    if (inside) {
      const f = inside.palette.fog;
      fog.color.copy(indoorColors.night.set(f.night)).lerp(indoorColors.day.set(f.day), blend.current);
      fog.near = f.near;
      fog.far = f.far;
    } else {
      fog.near = FOG.near;
      fog.far = FOG.far;
      fog.color.copy(background);
    }
    const perspective = camera as THREE.PerspectiveCamera;
    const far = Math.max(FOG.far + 5, MIN_CAMERA_FAR);
    if (Math.abs(perspective.far - far) > 0.5) {
      perspective.far = far;
      perspective.updateProjectionMatrix();
    }
  }, -1);

  return (
    <>
      <ambientLight ref={ambient} intensity={goal ? AMBIENT.light : AMBIENT.dark} />
      <Grass blend={blend} animated={props.animated} blades={props.grassBlades} fog={FOG} />
      <SkyDome blend={blend} />
      <Meadow blend={blend} animated={props.animated} />
      <Oddities blend={blend} animated={props.animated} />
      <Interiors blend={blend} animated={props.animated} />
      <Portals blend={blend} resolutionScale={props.portalScale} />
      <SkySquares animated={props.animated} blend={blend} />
      <Shards animated={props.animated} lowPerformance={props.lowPerformance} blend={blend} />
    </>
  );
}

// ==========================================
// Cúpula del cielo: degradado del horizonte al cenit
// ==========================================

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    float y = normalize(vDir).y;
    vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, y));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function SkyDome({ blend }: { blend: BlendRef }) {
  const mesh = useRef<THREE.Mesh>(null);
  const colors = useMemo(
    () => ({
      zenithDay: new THREE.Color(SKY.day.zenith),
      zenithNight: new THREE.Color(SKY.night.zenith),
    }),
    []
  );
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  // Sigue a la cámara (también a la de los portales), justo dentro del plano lejano.
  useEffect(() => {
    const follow = (camera: THREE.Camera) => {
      if (!mesh.current) return;
      mesh.current.position.copy(camera.position);
      mesh.current.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.9);
    };
    viewFollowers.add(follow);
    return () => {
      viewFollowers.delete(follow);
    };
  }, []);
  useFrame(({ camera }) => {
    material.uniforms.uZenith.value.copy(colors.zenithNight).lerp(colors.zenithDay, blend.current);
    material.uniforms.uHorizon.value.copy(BG_DARK).lerp(BG_LIGHT, blend.current);
    if (mesh.current) {
      mesh.current.position.copy(camera.position);
      mesh.current.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.9);
    }
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}

// ==========================================
// Claro: cuadros grises que aparecen y se apagan en la cúpula del cielo
// ==========================================

const SQUARE_COUNT = 110;
const SQUARE_PERIOD = 3.2;
const SQUARE_GRAY = new THREE.Color("#9ca3af");

function SkySquares({ animated, blend }: { animated: boolean; blend: BlendRef }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const squares = useMemo(() => Array.from({ length: SQUARE_COUNT }, () => ({ phase: Math.random(), slot: -1 })), []);
  const bg = useMemo(() => new THREE.Color(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const time = useRef(0);

  // Coloca un cuadro en un punto al azar de la cúpula, mirando hacia el centro.
  const place = (i: number) => {
    const theta = Math.random() * Math.PI * 2;
    const elevation = THREE.MathUtils.degToRad(10 + Math.random() * 65);
    // Cúpula lejana alrededor del jugador: sobre el cielo azul se ven a lo lejos y la
    // bruma de mediodía los suaviza.
    const radius = 70 + Math.random() * 30;
    const cx = camera.position.x;
    const cz = camera.position.z;
    dummy.position.set(
      cx + Math.cos(theta) * Math.cos(elevation) * radius,
      Math.sin(elevation) * radius,
      cz + Math.sin(theta) * Math.cos(elevation) * radius
    );
    dummy.lookAt(cx, 0, cz);
    dummy.scale.setScalar(4.2 + Math.random() * 3);
    dummy.updateMatrix();
    mesh.current!.setMatrixAt(i, dummy.matrix);
  };

  useFrame((_, delta) => {
    if (!mesh.current) return;
    const strength = blend.current;
    mesh.current.visible = strength > 0.001;
    if (!mesh.current.visible) return;
    if (animated) time.current += delta;
    bg.copy(BG_DARK).lerp(BG_LIGHT, strength);
    squares.forEach((s, i) => {
      const tt = time.current / SQUARE_PERIOD + s.phase;
      const slot = Math.floor(tt);
      // Al terminar su ciclo, el cuadro reaparece en otro lugar.
      if (slot !== s.slot) {
        s.slot = slot;
        place(i);
      }
      const opacity = Math.sin((tt - slot) * Math.PI) * 0.45 * strength;
      // Sin transparencia real: se mezcla con el color actual del cielo según la opacidad.
      mesh.current!.setColorAt(i, tmpColor.copy(bg).lerp(SQUARE_GRAY, opacity));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SQUARE_COUNT]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

// ==========================================
// Oscuro: rombos de vidrio y polvo
// ==========================================

// Vidrio (30%) y polvo (70%).
const GLASS = new THREE.Color("rgb(240, 245, 255)");
const DUST = new THREE.Color("rgb(80, 80, 85)");

/** Lado de la caja de rombos que acompaña al jugador (se repite al moverse). */
const NEAR_BOX = 28;
/** Parte de los rombos que forma la nube cercana (el resto llena el cielo). */
const NEAR_SHARE = 0.55;

interface Shard {
  home: THREE.Vector3;
  size: number;
  alpha: number;
  color: THREE.Color;
  rotX: number;
  rotZ: number;
  spinX: number;
  spinZ: number;
  wobble: number;
  phase: number;
  near: boolean;
}

// Rombo plano: largo 2.5 veces el ancho.
function diamondGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 2.5, 0, 1, 0, 0, 0, -2.5, 0, -1, 0, 0], 3));
  g.setIndex([0, 3, 1, 1, 3, 2]);
  return g;
}

function createShard(near: boolean): Shard {
  const home = new THREE.Vector3();
  let size: number;
  if (near) {
    // Nube que acompaña al jugador: x/z dentro de una caja que se repite alrededor de la
    // cámara (siempre hay partículas cerca, vaya donde vaya), a la altura de los ojos y algo más.
    home.set(Math.random() * NEAR_BOX, 0.4 + Math.pow(Math.random(), 1.4) * 9, Math.random() * NEAR_BOX);
    size = (Math.random() * 1.5 + 0.5) * 0.02;
  } else {
    // El cielo: una cúpula lejana alrededor de la cámara (como las estrellas). Lejos y
    // por encima del horizonte: si estuviera cerca se verían rombos grandes pegados a la pantalla.
    const theta = Math.random() * Math.PI * 2;
    const elevation = 0.15 + Math.asin(Math.random() * 0.98) * 0.85;
    const radius = 90 + Math.pow(Math.random(), 0.8) * 110;
    home.set(
      Math.cos(theta) * Math.cos(elevation) * radius,
      0.5 + Math.sin(elevation) * radius,
      Math.sin(theta) * Math.cos(elevation) * radius
    );
    size = (Math.random() * 1.5 + 0.5) * radius * 0.0022;
  }
  return {
    home,
    size,
    alpha: near ? Math.random() * 0.5 + 0.2 : Math.random() * 0.45 + 0.12,
    color: Math.random() > 0.7 ? GLASS : DUST,
    rotX: Math.random() * Math.PI * 2,
    rotZ: Math.random() * Math.PI * 2,
    spinX: (Math.random() - 0.5) * 1.2,
    spinZ: (Math.random() - 0.5) * 3,
    wobble: 0.3 + Math.random() * 0.8,
    phase: Math.random() * Math.PI * 2,
    near,
  };
}

function Shards({ animated, lowPerformance, blend }: { animated: boolean; lowPerformance: boolean; blend: BlendRef }) {
  const count = lowPerformance ? 900 : 1800;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const geometry = useMemo(diamondGeometry, []);
  const shards = useMemo(() => Array.from({ length: count }, (_, i) => createShard(i < count * NEAR_SHARE)), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const bg = useMemo(() => new THREE.Color(), []);
  const time = useRef(0);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, rawDelta) => {
    if (!mesh.current) return;
    // Al pasar a claro los rombos se desvanecen (y se encogen un poco) en el cielo.
    const strength = 1 - blend.current;
    mesh.current.visible = strength > 0.001;
    if (!mesh.current.visible) return;
    bg.copy(BG_DARK).lerp(BG_LIGHT, blend.current);
    const shrink = 0.6 + 0.4 * strength;

    const delta = animated ? Math.min(rawDelta, 0.05) : 0;
    time.current += delta;
    const t = time.current;
    const px = camera.position.x;
    const pz = camera.position.z;

    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      s.rotX += s.spinX * delta;
      s.rotZ += s.spinZ * delta;

      // Deriva suave alrededor de su posición de origen.
      // Posición base: la nube cercana se repite en una caja alrededor de la cámara;
      // el cielo se mueve con ella (como las estrellas).
      let baseX: number;
      let baseZ: number;
      let edgeFade = 1;
      if (s.near) {
        const half = NEAR_BOX / 2;
        const dx = ((((s.home.x - px) % NEAR_BOX) + NEAR_BOX * 1.5) % NEAR_BOX) - half;
        const dz = ((((s.home.z - pz) % NEAR_BOX) + NEAR_BOX * 1.5) % NEAR_BOX) - half;
        baseX = px + dx;
        baseZ = pz + dz;
        // Se desvanecen cerca del borde de la caja para no aparecer de golpe.
        edgeFade = THREE.MathUtils.clamp((half - Math.max(Math.abs(dx), Math.abs(dz))) / 4, 0, 1);
      } else {
        baseX = px + s.home.x;
        baseZ = pz + s.home.z;
      }
      const x = baseX + Math.sin(t * 0.35 * s.wobble + s.phase) * s.wobble;
      const y = s.home.y + Math.sin(t * 0.27 * s.wobble + s.phase * 1.7) * s.wobble * 0.5;
      const z = baseZ + Math.cos(t * 0.31 * s.wobble + s.phase) * s.wobble;

      dummy.position.set(x, y, z);
      dummy.rotation.set(s.rotX, 0, s.rotZ);
      dummy.scale.setScalar(s.size * shrink);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);

      // Sin transparencia real: se mezcla con el color actual del cielo según la opacidad.
      const alpha = s.alpha * strength * edgeFade;
      color.copy(bg).lerp(s.color, alpha);
      mesh.current.setColorAt(i, color);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} frustumCulled={false}>
      {/* Sin neblina: la nube cercana nunca llega a ella y la del cielo está lejos a propósito. */}
      <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} fog={false} />
    </instancedMesh>
  );
}
