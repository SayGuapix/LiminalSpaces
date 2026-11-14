// ==========================================
// Portals.tsx - LAS PUERTAS QUE LLEVAN A LOS INTERIORES
// ==========================================
// En el hueco de la puerta de cada casa se ve, en vivo, la sala del interior; y en el
// hueco de la puerta del interior, el prado. Cada puerta es un plano que muestra una
// imagen dibujada desde una cámara virtual: la cámara del jugador corrida por la
// traslación entre las dos puertas (portalOffset), así la perspectiva coincide y la
// casa parece enorme por dentro. Al cruzar el umbral, Player traslada al jugador
// (portalCross) y la vista sigue igual.
//
// - En las casas el portal no está en la puerta sino en medio del pasillo de entrada,
//   cruzándolo de pared a pared: ese tramo existe igual dentro de la casa real, así al
//   cruzar no se nota ningún corte y se sale al prado por la puerta de verdad.
// - Un plano de corte en el otro portal deja fuera lo que queda detrás de él.
// - La neblina del dibujo es la del otro lado (la del interior o la del prado).
// - Rendimiento: solo se dibuja el portal más cercano, si está a menos de 35 m y en
//   pantalla, y a una resolución que depende del nivel de calidad.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LEVELS, OUTDOOR_FOG, portalOffset, type Level } from "./interiorMaps";
import { followView } from "./viewFollowers";

const MAX_DISTANCE = 35;
/** El plano del portal queda un poco del otro lado del umbral: así no lo corta el near de la cámara al cruzar. */
const INSET = 0.15;

const portalVertex = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const portalFragment = /* glsl */ `
  uniform sampler2D uView;
  uniform vec2 uResolution;
  void main() {
    gl_FragColor = texture2D(uView, gl_FragCoord.xy / uResolution);
    #include <colorspace_fragment>
  }
`;

interface PortalSide {
  level: Level;
  /** true: puerta de la casa (muestra el interior). false: puerta del interior (muestra el prado). */
  inward: boolean;
  mesh: THREE.Mesh | null;
}

export default function Portals({ blend, resolutionScale }: { blend: React.MutableRefObject<number>; resolutionScale: number }) {
  const { gl, scene, camera, size } = useThree();
  const target = useMemo(() => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true }), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: portalVertex,
        fragmentShader: portalFragment,
        uniforms: { uView: { value: target.texture }, uResolution: { value: new THREE.Vector2(1, 1) } },
        side: THREE.DoubleSide,
      }),
    [target]
  );
  const virtual = useMemo(() => new THREE.PerspectiveCamera(), []);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projScreen = useMemo(() => new THREE.Matrix4(), []);
  const buffer = useMemo(() => new THREE.Vector2(), []);
  const clip = useMemo(() => new THREE.Plane(), []);
  const colors = useMemo(() => ({ day: new THREE.Color(), night: new THREE.Color() }), []);
  // Los Backrooms (oneWay) solo tienen el lado de adentro: la puerta sola del prado no muestra nada.
  const sides = useRef<PortalSide[]>(
    LEVELS.flatMap((level) => (level.oneWay ? [false] : [true, false]).map((inward) => ({ level, inward, mesh: null })))
  );

  useEffect(
    () => () => {
      target.dispose();
      material.dispose();
    },
    [target, material]
  );

  // Tamaño de la imagen: el del lienzo por la escala del nivel de calidad.
  useEffect(() => {
    gl.getDrawingBufferSize(buffer);
    material.uniforms.uResolution.value.copy(buffer);
    target.setSize(Math.max(1, Math.round(buffer.x * resolutionScale)), Math.max(1, Math.round(buffer.y * resolutionScale)));
  }, [gl, size, resolutionScale, target, material, buffer]);

  useFrame(() => {
    // El portal visible más cercano.
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    let best: PortalSide | null = null;
    let bestDistance = MAX_DISTANCE;
    for (const side of sides.current) {
      if (!side.mesh) continue;
      const d = side.mesh.position.distanceTo(camera.position);
      if (d < bestDistance && frustum.intersectsObject(side.mesh)) {
        best = side;
        bestDistance = d;
      }
    }
    for (const side of sides.current) if (side.mesh) side.mesh.visible = side === best;
    if (!best) return;

    const { level, inward } = best;
    const offset = portalOffset(level);
    if (!inward) offset.negate();
    const pCam = camera as THREE.PerspectiveCamera;
    virtual.copy(pCam);
    virtual.position.add(offset);
    virtual.updateMatrixWorld();

    // Corte en la otra puerta: solo lo que queda del otro lado.
    const a = level.portalAxis;
    const axis = a === "x" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    if (inward) clip.set(axis.negate(), level.remotePortal[a] + 0.01);
    else clip.set(axis, -(level.realPortal[a] - 0.01));

    // Neblina del otro lado.
    const fog = scene.fog as THREE.Fog | null;
    const saved = fog ? { near: fog.near, far: fog.far, color: fog.color.clone() } : null;
    if (fog) {
      if (inward) {
        const f = level.palette.fog;
        fog.color.copy(colors.night.set(f.night)).lerp(colors.day.set(f.day), blend.current);
        fog.near = f.near;
        fog.far = f.far;
      } else {
        fog.color.copy(OUTDOOR_FOG.color);
        fog.near = OUTDOOR_FOG.near;
        fog.far = OUTDOOR_FOG.far;
      }
    }

    best.mesh!.visible = false;
    const previousTarget = gl.getRenderTarget();
    const previousPlanes = gl.clippingPlanes;
    gl.clippingPlanes = [clip];
    followView(virtual);
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, virtual);
    gl.setRenderTarget(previousTarget);
    followView(camera);
    gl.clippingPlanes = previousPlanes;
    best.mesh!.visible = true;

    if (fog && saved) {
      fog.near = saved.near;
      fog.far = saved.far;
      fog.color.copy(saved.color);
    }
  });

  return (
    <>
      {sides.current.map((side, i) => {
        const { level } = side;
        const p = (side.inward ? level.realPortal : level.remotePortal).clone();
        // Del lado de afuera el plano queda un poco más adentro; del interior, un poco más afuera.
        p[level.portalAxis] += side.inward ? -INSET : INSET;
        // Algo más grande que el hueco: sus bordes quedan metidos en paredes, piso y techo.
        const w = level.portalHalf * 2 + 0.04;
        const h = level.portalHeight + 0.04;
        return (
          <mesh
            key={i}
            ref={(m) => {
              side.mesh = m;
            }}
            position={[p.x, p.y + h / 2 - 0.02, p.z]}
            rotation={[0, level.portalAxis === "x" ? Math.PI / 2 : 0, 0]}
            material={material}
            visible={false}
            raycast={() => null}
          >
            <planeGeometry args={[w, h]} />
          </mesh>
        );
      })}
    </>
  );
}
