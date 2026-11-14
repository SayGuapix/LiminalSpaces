// ==========================================
// Clouds.tsx - NUBES DENTRO DE LOS INTERIORES
// ==========================================
// Nubes de verdad (no esferas): cada una es un montón de manchas suaves que siempre miran
// a la cámara (billboards), con una textura de algodón hecha en un canvas. Blancas, con
// la base apenas sombreada, de día y de noche.
//
// - Se atraviesan: no tienen colisión y, al acercarse, cada mancha se desvanece; dentro
//   de una nube la vista queda envuelta en blanco.
// - Todas las nubes de un interior son una sola malla instanciada (un draw call). Se
//   ordenan de lejos a cerca cada pocos frames para que la transparencia se vea bien.
// - Se mueven apenas (quietas con prefers-reduced-motion) y respetan la neblina.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { REMOTE_X_MIN, portalOffset, type Level } from "./interiorMaps";
import { interiorTime } from "./interiorShaders";

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Textura de algodón: muchas manchas redondas suaves, recortadas por un círculo difuso. */
function puffTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = seeded(31);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * size * 0.26;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const r = size * (0.12 + rand() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Borde suave: nada de esquinas cuadradas.
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size / 2);
  mask.addColorStop(0, "rgba(255,255,255,1)");
  mask.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const vertexShader = /* glsl */ `
  attribute vec4 aPuff;   // centro (x, y, z) y tamaño
  attribute vec3 aExtra;  // giro, tono (0 abajo, 1 arriba), fase
  uniform float uTime;
  varying vec2 vUv;
  varying float vShade;
  varying float vNear;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vShade = aExtra.y;
    vec3 center = aPuff.xyz + vec3(sin(uTime * 0.35 + aExtra.z), sin(uTime * 0.27 + aExtra.z * 1.7) * 0.6, cos(uTime * 0.3 + aExtra.z)) * 0.05;
    vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
    float c = cos(aExtra.x);
    float s = sin(aExtra.x);
    vec2 corner = mat2(c, s, -s, c) * position.xy * aPuff.w;
    mvPosition.xy += corner;
    // Muy cerca (o dentro de la nube) cada mancha se desvanece: no se ven bordes al atravesarla.
    vNear = smoothstep(0.1, 1.3, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uLight;
  uniform vec3 uShadow;
  varying vec2 vUv;
  varying float vShade;
  varying float vNear;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(uMap, vUv).a * vNear * 0.85;
    if (a < 0.01) discard;
    // Dentro de cada mancha, el centro algo más claro.
    float inner = 1.0 - length(vUv - 0.5) * 0.5;
    vec3 col = mix(uShadow, uLight, clamp(vShade * inner + 0.35, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
    // Neblina apenas: las nubes siguen blancas aunque estén al fondo del pasillo.
    #ifdef USE_FOG
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.3);
    #endif
  }
`;

interface Puff {
  center: THREE.Vector3;
  size: number;
  rotation: number;
  shade: number;
  phase: number;
}

/** Manchas de una nube: más en la superficie del elipsoide (bultos), la base algo plana. */
function cloudPuffs(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rand: () => number): Puff[] {
  const count = THREE.MathUtils.clamp(Math.round(14 * (rx * ry + rx * rz + ry * rz)), 18, 90);
  const scale = 0.6 + 0.4 * Math.min(rx, ry, rz);
  const out: Puff[] = [];
  for (let i = 0; i < count; i++) {
    // Dirección al azar y distancia hacia la superficie.
    const dir = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
    dir.normalize().multiplyScalar(0.25 + 0.6 * Math.sqrt(rand()));
    const dy = Math.max(dir.y * ry, -0.7 * ry);
    const center = new THREE.Vector3(cx + dir.x * rx, cy + dy, cz + dir.z * rz);
    out.push({
      center,
      size: (0.9 + rand() * 0.9) * scale,
      rotation: rand() * Math.PI * 2,
      // Arriba blanca, abajo gris (con algo de variación).
      shade: THREE.MathUtils.clamp((dy / ry) * 0.5 + 0.5 + (rand() - 0.5) * 0.2, 0, 1),
      phase: rand() * 100,
    });
  }
  return out;
}

export default function Clouds({ level, animated }: { level: Level; animated: boolean }) {
  const puffs = useMemo(() => {
    const rand = seeded(9001 + level.remote.x);
    return level.props
      .filter((p) => p.kind === "cloud" && p.cloud)
      .flatMap((p) => {
        const [rx, ry, rz] = p.cloud!.radii;
        return cloudPuffs(p.x, p.cloud!.y, p.z, rx, ry, rz, rand);
      });
  }, [level]);

  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.setIndex(quad.index);
    g.setAttribute("position", quad.attributes.position);
    g.setAttribute("uv", quad.attributes.uv);
    g.setAttribute("aPuff", new THREE.InstancedBufferAttribute(new Float32Array(puffs.length * 4), 4));
    g.setAttribute("aExtra", new THREE.InstancedBufferAttribute(new Float32Array(puffs.length * 3), 3));
    g.instanceCount = puffs.length;
    return g;
  }, [puffs]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uMap: { value: null },
            uTime: { value: 0 },
            uLight: { value: new THREE.Color("#ffffff") },
            // Sombra apenas azulada: la nube es blanca (también de noche, como el cielo del hueco).
            uShadow: { value: new THREE.Color("#dde3ec") },
          },
        ]),
      }),
    []
  );
  const texture = useMemo(() => puffTexture(), []);
  useEffect(() => {
    material.uniforms.uMap.value = texture;
  }, [material, texture]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
    [geometry, material, texture]
  );

  // Orden de lejos a cerca respecto de la cámara que ve el interior (la del jugador o,
  // desde el prado, la del portal: la misma corrida por la traslación de la puerta).
  const order = useRef<number[]>(puffs.map((_, i) => i));
  const frame = useRef(0);
  const local = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => (level.oneWay ? new THREE.Vector3() : portalOffset(level)), [level]);
  const writeOrder = (camera: THREE.Camera) => {
    local.copy(camera.position);
    if (camera.position.x < REMOTE_X_MIN) local.add(offset);
    local.sub(level.remote);
    order.current.sort((a, b) => local.distanceToSquared(puffs[b].center) - local.distanceToSquared(puffs[a].center));
    const aPuff = geometry.attributes.aPuff as THREE.InstancedBufferAttribute;
    const aExtra = geometry.attributes.aExtra as THREE.InstancedBufferAttribute;
    order.current.forEach((src, i) => {
      const p = puffs[src];
      aPuff.setXYZW(i, p.center.x, p.center.y, p.center.z, p.size);
      aExtra.setXYZ(i, p.rotation, p.shade, p.phase);
    });
    aPuff.needsUpdate = true;
    aExtra.needsUpdate = true;
  };

  useFrame(({ camera }) => {
    if (!puffs.length) return;
    if (frame.current++ % 4 === 0) writeOrder(camera);
    material.uniforms.uTime.value = animated ? interiorTime.value : 0;
  });

  if (!puffs.length) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} raycast={() => null} />;
}
