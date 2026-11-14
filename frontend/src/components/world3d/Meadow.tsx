// ==========================================
// Meadow.tsx - EL PRADO LIMINAL
// ==========================================
// Casas pastel sin puertas, cercas blancas, una torre de agua y faroles (datos en
// liminal.ts). Dos experiencias según el tema:
//
// - Claro (mediodía eterno): todo quieto y luminoso, ventanas oscuras que reflejan
//   el cielo, faroles apagados.
// - Oscuro (noche liminal): cielo con estrellas, algunas ventanas encendidas con luz
//   cálida (otras no), faroles con su halo y una baliza roja que parpadea en la torre.
//
// Rarezas: una casa al revés clavada por el techo, otra enterrada hasta el segundo
// piso, otra flotando, una puerta sola y una escalera que no lleva a ningún lado.
// Dos casas se pueden entrar y por dentro son enormes (interiorMaps.ts e Interiors.tsx):
// aquí solo está su cascarón, con la puerta.
//
// Al fondo, más allá de donde se puede caminar, un barrio de casas sueltas en cuadrícula
// que sube por las montañas y se pierde en la neblina, y un agujero gigante con anillos
// de casas bajando por sus paredes hacia lo negro (farHouses, HOLE en liminal.ts).
//
// Rendimiento: todas las casas son una sola malla (colores por vértice) y todas las
// ventanas otra; las cercas son instancias. Proyectan sombra, que se hornea una vez.
// Las del fondo son otra malla, simplificada (sin marcos ni esquineros) y sin sombra.

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { at, box, painted } from "./geometryKit";
import { viewFollowers } from "./viewFollowers";
import {
  DOOR,
  FENCES,
  FLOOR_HEIGHT,
  HOUSES,
  HOUSE_SINK,
  LAMPS,
  LONE_DOOR,
  LONE_DOOR_SWING,
  PICKET_SPACING,
  STAIRS,
  TOWER,
  WALL,
  enterableWalls,
  farHouses,
  houseBase,
  roofHeight,
  terrainHeight,
  type FarHouse,
  type House,
} from "./liminal";

type BlendRef = MutableRefObject<number>;

const TRIM = "#fbfaf3";
/** Color por el que se multiplica todo de noche (luz de luna azulada). */
const NIGHT_TINT = new THREE.Color("#27304a");
const WHITE = new THREE.Color("#ffffff");
/** Luz de noche: cálida, de bombilla incandescente (faroles y ventanas). */
const WARM_LIGHT = new THREE.Color("#ffd9a0");

/** Prisma triangular (techo o frontón) con la cumbrera a lo largo de X. */
function gable(halfDepth: number, height: number, length: number) {
  const shape = new THREE.Shape([new THREE.Vector2(-halfDepth, 0), new THREE.Vector2(halfDepth, 0), new THREE.Vector2(0, height)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

interface WindowSpot {
  matrix: THREE.Matrix4;
  lit: boolean;
}

/** Paredes, techo y marcos de una casa (en su espacio local) y dónde van sus vidrios. */
function buildHouse(house: House, rand: () => number) {
  const { width: w, depth: d, floors } = house;
  const H = floors * FLOOR_HEIGHT;
  const SINK = HOUSE_SINK;
  const parts: THREE.BufferGeometry[] = [];
  const windows: WindowSpot[] = [];
  const enterable = house.kind === "enterable";

  if (enterable) {
    for (const wall of enterableWalls(house)) parts.push(painted(box(...wall.size), house.wall, at(...wall.center)));
    // Marco de la puerta y el entrepiso que cierra el cuarto por arriba.
    parts.push(painted(box(DOOR.width + 0.3, 0.15, 0.26), TRIM, at(0, DOOR.height + 0.07, d / 2 - WALL / 2)));
    for (const sx of [-1, 1]) parts.push(painted(box(0.15, DOOR.height, 0.26), TRIM, at(sx * (DOOR.width / 2 + 0.07), DOOR.height / 2, d / 2 - WALL / 2)));
  } else {
    parts.push(painted(box(w, H + SINK, d), house.wall, at(0, (H - SINK) / 2, 0)));
  }
  // Esquineros y la franja entre pisos, en blanco.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(painted(new THREE.BoxGeometry(0.22, H + SINK, 0.22), TRIM, at((sx * w) / 2, (H - SINK) / 2, (sz * d) / 2)));
    }
  }
  // La franja entre pisos: un anillo por fuera (en la casa hueca no tapa el cielo raso).
  for (let f = 1; f < floors; f++) {
    const y = f * FLOOR_HEIGHT;
    for (const sz of [-1, 1]) parts.push(painted(box(w + 0.12, 0.18, 0.08), TRIM, at(0, y, sz * (d / 2 + 0.02))));
    for (const sx of [-1, 1]) parts.push(painted(box(0.08, 0.18, d + 0.12), TRIM, at(sx * (w / 2 + 0.02), y, 0)));
  }
  // Techo a dos aguas con alero, y el frontón (del color de la pared) bajo él.
  const roofH = roofHeight(house);
  parts.push(painted(gable(d / 2 + 0.45, roofH + 0.3, w + 0.6), house.roof, at(0, H - 0.3, 0)));
  parts.push(painted(gable(d / 2, roofH, w), house.wall, at(0, H, 0)));

  // Ventanas: en las fachadas largas (±Z) y una por piso en los costados (±X).
  const frame = new THREE.BoxGeometry(1.15, 1.45, 0.1);
  const pane = new THREE.BoxGeometry(0.9, 1.2, 0.06);
  const perRow = Math.max(2, Math.floor(w / 2.6));
  for (let f = 0; f < floors; f++) {
    const y = f * FLOOR_HEIGHT + 1.5;
    const spots: THREE.Matrix4[] = [];
    for (const side of [1, -1]) {
      for (let i = 0; i < perRow; i++) {
        const x = (i - (perRow - 1) / 2) * (w / perRow);
        // En la casa que se puede entrar, la puerta ocupa el centro de la planta baja.
        if (enterable && f === 0 && side > 0 && Math.abs(x) < DOOR.width) continue;
        spots.push(new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI).setPosition(x, y, (side * d) / 2));
      }
      spots.push(new THREE.Matrix4().makeRotationY((side * Math.PI) / 2).setPosition((side * w) / 2, y, 0));
    }
    for (const m of spots) {
      parts.push(painted(frame.clone(), TRIM, m.clone().multiply(at(0, 0, 0.03))));
      windows.push({ matrix: m.clone().multiply(at(0, 0, 0.08)), lit: rand() < 0.4 });
    }
  }
  return { parts, windows, pane };
}

/** Casa del barrio del fondo: solo el volumen, el techo y los vidrios (se ve de lejos). */
function buildFarHouse(house: FarHouse, rand: () => number, pane: THREE.BufferGeometry) {
  const { width: w, depth: d, floors, sink } = house;
  const H = floors * FLOOR_HEIGHT;
  const roofH = roofHeight(house);
  const wall = new THREE.Color(house.wall).multiplyScalar(house.shade);
  const roof = new THREE.Color(house.roof).multiplyScalar(house.shade);
  const parts = [
    painted(box(w, H + sink, d), wall, at(0, (H - sink) / 2, 0)),
    painted(gable(d / 2 + 0.45, roofH + 0.3, w + 0.6), roof, at(0, H - 0.3, 0)),
    painted(gable(d / 2, roofH, w), wall, at(0, H, 0)),
  ];
  const panes: { geometry: THREE.BufferGeometry; lit: boolean }[] = [];
  const perRow = Math.max(2, Math.floor(w / 2.6));
  for (let f = 0; f < floors; f++) {
    for (const side of [1, -1]) {
      for (let i = 0; i < perRow; i++) {
        const x = (i - (perRow - 1) / 2) * (w / perRow);
        // Hondo en el agujero casi no quedan luces encendidas.
        panes.push({ geometry: pane.clone().applyMatrix4(at(x, f * FLOOR_HEIGHT + 1.5, side * (d / 2 + 0.03))), lit: rand() < 0.3 * house.shade });
      }
    }
  }
  return { parts, panes };
}

/** Matriz de la casa en el mundo; la de al revés gira sobre X y queda clavada por el techo. */
function housePlacement(house: House) {
  const place = new THREE.Matrix4().makeRotationY(house.rotation).setPosition(house.x, houseBase(house), house.z);
  if (house.kind !== "upsideDown") return place;
  const top = house.floors * FLOOR_HEIGHT + roofHeight(house) + 0.3;
  return place.multiply(at(0, top - 1.2, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI + 0.12));
}

/** Una puerta de pie, sola, sin casa, abierta: por ella se sale de los Backrooms. */
function loneDoor() {
  const W = DOOR.width;
  const leafW = W - 0.04;
  // La hoja gira sobre la bisagra izquierda y queda abierta hacia afuera.
  const leaf = new THREE.Matrix4().makeTranslation(-W / 2, 0, 0).multiply(new THREE.Matrix4().makeRotationY(LONE_DOOR_SWING));
  const parts = [
    painted(box(leafW, DOOR.height - 0.04, 0.05), "#6b4f3a", leaf.clone().multiply(at(leafW / 2, DOOR.height / 2, 0))),
    painted(new THREE.SphereGeometry(0.05, 8, 6), "#c9a95c", leaf.clone().multiply(at(leafW - 0.12, 1.05, 0.05))),
    painted(box(0.15, DOOR.height + 0.15, 0.14), TRIM, at(-W / 2 - 0.075, (DOOR.height + 0.15) / 2, 0)),
    painted(box(0.15, DOOR.height + 0.15, 0.14), TRIM, at(W / 2 + 0.075, (DOOR.height + 0.15) / 2, 0)),
    painted(box(W + 0.3, 0.15, 0.14), TRIM, at(0, DOOR.height + 0.075, 0)),
  ];
  const place = new THREE.Matrix4().makeRotationY(LONE_DOOR.rotation).setPosition(LONE_DOOR.x, terrainHeight(LONE_DOOR.x, LONE_DOOR.z), LONE_DOOR.z);
  return parts.map((g) => g.applyMatrix4(place));
}

/** Escalones que suben y terminan en el aire. */
function stairsToNowhere() {
  const parts: THREE.BufferGeometry[] = [];
  const { rise: RISE, run: RUN } = STAIRS;
  for (let i = 0; i < STAIRS.steps; i++) {
    const h = (i + 1) * RISE + 0.5;
    parts.push(painted(box(STAIRS.width, h, RUN), "#d8d4c8", at(0, h / 2 - 0.5, (i - STAIRS.steps / 2) * RUN)));
  }
  const place = new THREE.Matrix4().makeRotationY(STAIRS.rotation).setPosition(STAIRS.x, terrainHeight(STAIRS.x, STAIRS.z), STAIRS.z);
  return parts.map((g) => g.applyMatrix4(place));
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

// Vidrios: de día oscuros con algo de cielo; de noche, encendidos (luz cálida) o negros.
const windowVertex = /* glsl */ `
  attribute float aLit;
  varying float vLit;
  varying float vDepth;
  varying float vY;
  void main() {
    vLit = aLit;
    vY = position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const windowFragment = /* glsl */ `
  uniform float uNight;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vLit;
  varying float vDepth;
  varying float vY;
  void main() {
    vec3 day = mix(vec3(0.16, 0.22, 0.30), vec3(0.45, 0.62, 0.80), 0.35);
    vec3 night = mix(vec3(0.03, 0.035, 0.05), vec3(1.0, 0.76, 0.45), vLit);
    vec3 col = mix(day, night, uNight);
    // Una ventana encendida se ve a través de la neblina más que el resto.
    // Cerca del final de la neblina (el plano lejano de la cámara) se apagan igual: sin saltos.
    float glow = vLit * uNight * 0.6 * (1.0 - smoothstep(uFogFar * 0.8, uFogFar, vDepth));
    float fog = smoothstep(uFogNear, uFogFar, vDepth) * (1.0 - glow);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

export default function Meadow({ blend, animated }: { blend: BlendRef; animated: boolean }) {
  const { houses, far, windows } = useMemo(() => {
    const rand = seeded(4242);
    const houseParts: THREE.BufferGeometry[] = [...loneDoor(), ...stairsToNowhere()];
    const panes: THREE.BufferGeometry[] = [];
    for (const house of HOUSES) {
      const place = housePlacement(house);
      const { parts, windows, pane } = buildHouse(house, rand);
      parts.forEach((p) => houseParts.push(p.applyMatrix4(place)));
      for (const spot of windows) {
        const g = pane.clone().toNonIndexed().applyMatrix4(place.clone().multiply(spot.matrix));
        g.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(spot.lit ? 1 : 0), 1));
        g.deleteAttribute("uv");
        g.deleteAttribute("normal");
        panes.push(g);
      }
    }
    // El barrio del fondo: otra malla (sin sombras), y sus vidrios con los demás.
    const farParts: THREE.BufferGeometry[] = [];
    const farPane = new THREE.BoxGeometry(0.9, 1.2, 0.06).toNonIndexed();
    for (const house of farHouses()) {
      // Inclinada según la pendiente (sin estirar la base para alcanzar el suelo).
      const place = new THREE.Matrix4().compose(new THREE.Vector3(house.x, house.base, house.z), house.quaternion, new THREE.Vector3(1, 1, 1));
      const { parts, panes: farPanes } = buildFarHouse(house, rand, farPane);
      parts.forEach((p) => farParts.push(p.applyMatrix4(place)));
      for (const { geometry, lit } of farPanes) {
        geometry.applyMatrix4(place);
        geometry.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(lit ? 1 : 0), 1));
        geometry.deleteAttribute("uv");
        geometry.deleteAttribute("normal");
        panes.push(geometry);
      }
    }
    return {
      houses: mergeGeometries(houseParts)!,
      far: mergeGeometries(farParts)!,
      windows: mergeGeometries(panes)!,
    };
  }, []);

  const houseMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), []);
  const windowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: windowVertex,
        fragmentShader: windowFragment,
        uniforms: {
          uNight: { value: 0 },
          uFogColor: { value: new THREE.Color() },
          uFogNear: { value: 10 },
          uFogFar: { value: 100 },
        },
      }),
    []
  );
  useEffect(
    () => () => {
      [houses, far, windows, houseMaterial, windowMaterial].forEach((x) => x.dispose());
    },
    [houses, far, windows, houseMaterial, windowMaterial]
  );

  useFrame(({ scene }) => {
    const night = 1 - blend.current;
    houseMaterial.color.copy(WHITE).lerp(NIGHT_TINT, night);
    const u = windowMaterial.uniforms;
    u.uNight.value = night;
    if (scene.fog instanceof THREE.Fog) {
      u.uFogColor.value.copy(scene.fog.color);
      u.uFogNear.value = scene.fog.near;
      u.uFogFar.value = scene.fog.far;
    }
  });

  return (
    <group>
      <mesh geometry={houses} material={houseMaterial} castShadow receiveShadow raycast={() => null} />
      <mesh geometry={far} material={houseMaterial} raycast={() => null} />
      <mesh geometry={windows} material={windowMaterial} raycast={() => null} />
      <Fences blend={blend} />
      <WaterTower blend={blend} animated={animated} />
      <Lamps blend={blend} />
      <Stars blend={blend} />
    </group>
  );
}

// ==========================================
// Cercas blancas
// ==========================================

function Fences({ blend }: { blend: BlendRef }) {
  const { pickets, rails } = useMemo(() => {
    const pickets: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (const [a, b] of FENCES) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.round(length / PICKET_SPACING);
      const angle = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      const points = Array.from({ length: n + 1 }, (_, i) => {
        const x = a[0] + ((b[0] - a[0]) * i) / n;
        const z = a[1] + ((b[1] - a[1]) * i) / n;
        return new THREE.Vector3(x, terrainHeight(x, z), z);
      });
      for (const p of points) {
        dummy.position.copy(p);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        pickets.push(dummy.matrix.clone());
      }
      // Dos travesaños entre cada par de tablas, siguiendo la pendiente.
      for (let i = 0; i < n; i++) {
        const p = points[i];
        const q = points[i + 1];
        for (const h of [0.32, 0.72]) {
          dummy.position.set((p.x + q.x) / 2, (p.y + q.y) / 2 + h, (p.z + q.z) / 2);
          dummy.lookAt(q.x, q.y + h, q.z);
          dummy.scale.set(1, 1, p.distanceTo(q) + 0.01);
          dummy.updateMatrix();
          rails.push(dummy.matrix.clone());
        }
      }
    }
    return { pickets, rails };
  }, []);

  const geometries = useMemo(() => {
    const board = new THREE.BoxGeometry(0.09, 0.95, 0.035);
    board.translate(0, 0.475, 0);
    const tip = new THREE.ConeGeometry(0.064, 0.12, 4, 1);
    tip.rotateY(Math.PI / 4);
    tip.scale(1, 1, 0.4);
    tip.translate(0, 1.01, 0);
    const picket = mergeGeometries([board.toNonIndexed(), tip.toNonIndexed()])!;
    const rail = new THREE.BoxGeometry(0.05, 0.07, 1);
    rail.translate(0, 0, 0);
    return { picket, rail };
  }, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f7f7f2", roughness: 0.8 }), []);
  useEffect(
    () => () => {
      geometries.picket.dispose();
      geometries.rail.dispose();
      material.dispose();
    },
    [geometries, material]
  );

  const picketMesh = useRef<THREE.InstancedMesh>(null);
  const railMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    pickets.forEach((m, i) => picketMesh.current?.setMatrixAt(i, m));
    rails.forEach((m, i) => railMesh.current?.setMatrixAt(i, m));
    if (picketMesh.current) picketMesh.current.instanceMatrix.needsUpdate = true;
    if (railMesh.current) railMesh.current.instanceMatrix.needsUpdate = true;
  }, [pickets, rails]);

  useFrame(() => {
    material.color.set("#f7f7f2").lerp(NIGHT_TINT, 1 - blend.current);
  });

  const common = { castShadow: true, receiveShadow: true, frustumCulled: false, raycast: () => null };
  return (
    <>
      <instancedMesh ref={picketMesh} args={[geometries.picket, material, pickets.length]} {...common} />
      <instancedMesh ref={railMesh} args={[geometries.rail, material, rails.length]} {...common} />
    </>
  );
}

// ==========================================
// Torre de agua
// ==========================================

const LEG_HEIGHT = 9;

function WaterTower({ blend, animated }: { blend: BlendRef; animated: boolean }) {
  const ground = useMemo(() => terrainHeight(TOWER.x, TOWER.z), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#eef0f2", roughness: 0.55, metalness: 0.1 }), []);
  const beacon = useMemo(() => new THREE.MeshBasicMaterial({ color: "#5a1d1d", toneMapped: false }), []);
  const time = useRef(0);
  useEffect(
    () => () => {
      material.dispose();
      beacon.dispose();
    },
    [material, beacon]
  );

  // Patas, refuerzos en X entre ellas, tanque, techo y la baliza.
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const legs: [number, number][] = [
      [1.7, 1.7],
      [-1.7, 1.7],
      [-1.7, -1.7],
      [1.7, -1.7],
    ];
    for (const [x, z] of legs) parts.push(new THREE.CylinderGeometry(0.16, 0.2, LEG_HEIGHT + 1, 8).translate(x, (LEG_HEIGHT - 1) / 2, z).toNonIndexed());
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      for (const [y0, y1] of [
        [1, 4.5],
        [4.5, 1],
        [4.5, 8],
        [8, 4.5],
      ]) {
        const a = new THREE.Vector3(ax, y0, az);
        const b = new THREE.Vector3(bx, y1, bz);
        const dir = b.clone().sub(a);
        const brace = new THREE.CylinderGeometry(0.05, 0.05, dir.length(), 5);
        brace.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()));
        brace.translate((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2);
        parts.push(brace.toNonIndexed());
      }
    }
    parts.push(new THREE.CylinderGeometry(2.7, 2.7, 3.4, 32).translate(0, LEG_HEIGHT + 1.7, 0).toNonIndexed());
    parts.push(new THREE.ConeGeometry(2.7, 1.1, 32, 1, true).rotateX(Math.PI).translate(0, LEG_HEIGHT - 0.55, 0).toNonIndexed());
    parts.push(new THREE.ConeGeometry(2.95, 1.4, 32).translate(0, LEG_HEIGHT + 3.4 + 0.7, 0).toNonIndexed());
    parts.push(new THREE.TorusGeometry(2.95, 0.06, 6, 40).rotateX(Math.PI / 2).translate(0, LEG_HEIGHT + 0.2, 0).toNonIndexed());
    parts.push(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 5).translate(0, LEG_HEIGHT + 5.3, 0).toNonIndexed());
    return mergeGeometries(parts)!;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const night = 1 - blend.current;
    material.color.set("#eef0f2").lerp(NIGHT_TINT, night);
    if (animated) time.current += delta;
    // De noche la baliza parpadea (como en las torres reales): un destello cada 2 s.
    const pulse = animated ? Math.pow(Math.max(0, Math.sin(time.current * Math.PI)), 6) : 1;
    beacon.color.set("#5a1d1d").lerp(new THREE.Color("#ff3b30"), night * (0.25 + 0.75 * pulse));
  });

  return (
    <group position={[TOWER.x, ground - 0.2, TOWER.z]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow raycast={() => null} />
      <mesh position={[0, LEG_HEIGHT + 5.75, 0]} material={beacon} raycast={() => null}>
        <sphereGeometry args={[0.18, 12, 8]} />
      </mesh>
    </group>
  );
}

// ==========================================
// Faroles
// ==========================================

const LAMP_HEIGHT = 3.4;

/** Textura de halo (degradado radial), creada una vez. */
function haloTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,0.55)");
  g.addColorStop(0.45, "rgba(255,255,255,0.15)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Lamps({ blend }: { blend: BlendRef }) {
  const placed = useMemo(() => LAMPS.map(([x, z]) => new THREE.Vector3(x, terrainHeight(x, z), z)), []);
  const pole = useMemo(() => {
    const post = new THREE.CylinderGeometry(0.06, 0.09, LAMP_HEIGHT, 8).translate(0, LAMP_HEIGHT / 2, 0);
    const cap = new THREE.CylinderGeometry(0.08, 0.28, 0.22, 10).translate(0, LAMP_HEIGHT + 0.25, 0);
    return mergeGeometries([post.toNonIndexed(), cap.toNonIndexed()])!;
  }, []);
  const poleMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.6, metalness: 0.4 }), []);
  const bulbMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: "#d9d6cc", toneMapped: false }), []);
  const halo = useMemo(() => haloTexture(), []);
  const haloMaterial = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: halo,
        color: "#ffb870",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    [halo]
  );
  useEffect(
    () => () => {
      pole.dispose();
      poleMaterial.dispose();
      bulbMaterial.dispose();
      halo.dispose();
      haloMaterial.dispose();
    },
    [pole, poleMaterial, bulbMaterial, halo, haloMaterial]
  );

  const poles = useRef<THREE.InstancedMesh>(null);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    placed.forEach((p, i) => {
      poles.current?.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      bulbs.current?.setMatrixAt(i, m.makeTranslation(p.x, p.y + LAMP_HEIGHT + 0.08, p.z));
    });
    if (poles.current) poles.current.instanceMatrix.needsUpdate = true;
    if (bulbs.current) bulbs.current.instanceMatrix.needsUpdate = true;
  }, [placed]);

  useFrame(() => {
    const night = 1 - blend.current;
    bulbMaterial.color.set("#d9d6cc").lerp(WARM_LIGHT, night);
    haloMaterial.opacity = night * 0.8;
  });

  return (
    <>
      <instancedMesh ref={poles} args={[pole, poleMaterial, placed.length]} castShadow frustumCulled={false} raycast={() => null} />
      <instancedMesh ref={bulbs} args={[undefined, bulbMaterial, placed.length]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[0.16, 12, 8]} />
      </instancedMesh>
      {placed.map((p, i) => (
        <sprite key={i} material={haloMaterial} position={[p.x, p.y + LAMP_HEIGHT + 0.08, p.z]} scale={3.4} raycast={() => null} />
      ))}
    </>
  );
}

// ==========================================
// Estrellas (solo de noche)
// ==========================================

function Stars({ blend }: { blend: BlendRef }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const rand = seeded(99);
    const count = 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Sobre la mitad de arriba de una esfera unitaria, más densas hacia el horizonte.
      const theta = rand() * Math.PI * 2;
      const y = 0.04 + Math.pow(rand(), 1.4) * 0.96;
      const r = Math.sqrt(1 - y * y);
      positions.set([Math.cos(theta) * r, y, Math.sin(theta) * r], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({ color: "#dfe6ff", size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false }),
    []
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  // Siguen a la cámara (también a la de los portales), justo dentro del plano lejano.
  useEffect(() => {
    const follow = (camera: THREE.Camera) => {
      if (!points.current) return;
      points.current.position.copy(camera.position);
      points.current.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.85);
    };
    viewFollowers.add(follow);
    return () => {
      viewFollowers.delete(follow);
    };
  }, []);
  useFrame(({ camera }) => {
    const night = 1 - blend.current;
    material.opacity = night * 0.9;
    if (points.current) {
      points.current.visible = night > 0.01;
      points.current.position.copy(camera.position);
      points.current.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.85);
    }
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={-1} raycast={() => null} />;
}
