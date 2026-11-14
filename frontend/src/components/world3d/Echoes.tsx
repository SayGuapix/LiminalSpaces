// ==========================================
// Echoes.tsx - ECOS: NOTAS FLOTANDO EN EL MUNDO
// ==========================================
// Cada eco (echoesStore.ts) es una lucecita cálida que flota y respira donde alguien
// la dejó. Al acercarse aparece su texto, siempre de frente a la cámara. Mirándola,
// E (o click) suma un "Yo también estuve aquí".
//
// También deja en placeRef la función que dice dónde quedaría un eco nuevo: un poco
// delante del jugador, a la altura de los ojos, y en qué zona (prado o un interior).

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { UIText, type Interactable } from "./shared";
import { indoorAt } from "./interiorMaps";
import { hasLiked, likeEcho, useEchoes, type Echo, type Zone } from "./echoesStore";

/** Distancia (m) a la que se empieza a leer el texto. */
const READ_DISTANCE = 7;
/** Qué tan delante del jugador queda un eco nuevo. */
const PLACE_AHEAD = 1.2;

export type EchoSpot = { x: number; y: number; z: number; zona: Zone };

export interface EchoLabels {
  /** Lo que hace E al mirar un eco (y si ya se usó). */
  like: string;
  liked: string;
  /** Debajo del texto: cuántos estuvieron ahí. */
  count: (likes: number) => string;
}

const ORB_COLOR = "#fde68a";

export default function Echoes({
  placeRef,
  labels,
}: {
  placeRef: MutableRefObject<(() => EchoSpot) | null>;
  labels: EchoLabels;
}) {
  const echoes = useEchoes();
  const { camera } = useThree();

  useEffect(() => {
    const forward = new THREE.Vector3();
    placeRef.current = () => {
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize().multiplyScalar(PLACE_AHEAD);
      const x = camera.position.x + forward.x;
      const z = camera.position.z + forward.z;
      return { x, y: camera.position.y - 0.15, z, zona: indoorAt(x, z)?.kind ?? "prado" };
    };
    return () => {
      placeRef.current = null;
    };
  }, [camera, placeRef]);

  return (
    <group>
      {echoes.map((echo) => (
        <EchoNote key={echo.id} echo={echo} labels={labels} />
      ))}
    </group>
  );
}

const orbGeometry = new THREE.SphereGeometry(0.06, 16, 12);
const haloGeometry = new THREE.SphereGeometry(0.16, 16, 12);
const hitGeometry = new THREE.SphereGeometry(0.4, 8, 6);
const orbMaterial = new THREE.MeshBasicMaterial({ color: ORB_COLOR, toneMapped: false });
const haloMaterial = new THREE.MeshBasicMaterial({
  color: ORB_COLOR,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  toneMapped: false,
});
// Zona invisible (más grande que la luz) para apuntarle con la mira.
const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

function EchoNote({ echo, labels }: { echo: Echo; labels: EchoLabels }) {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const text = useRef<THREE.Group>(null);
  // Cada eco respira con su propio ritmo.
  const phase = useMemo(() => (echo.id * 1.618) % (Math.PI * 2), [echo.id]);

  const liked = hasLiked(echo.id);
  const interactable = useMemo<Interactable>(
    () => ({ id: `eco-${echo.id}`, label: liked ? labels.liked : labels.like, action: () => void likeEcho(echo.id) }),
    [echo.id, liked, labels]
  );

  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime + phase;
    if (group.current) group.current.position.y = echo.y + Math.sin(t * 0.9) * 0.06;
    if (halo.current) halo.current.scale.setScalar(1 + Math.sin(t * 1.7) * 0.18);
    if (text.current) {
      const d = Math.hypot(camera.position.x - echo.x, camera.position.z - echo.z, camera.position.y - echo.y);
      text.current.visible = d < READ_DISTANCE;
    }
  });

  return (
    <group ref={group} position={[echo.x, echo.y, echo.z]}>
      <mesh geometry={orbGeometry} material={orbMaterial} raycast={() => null} />
      <mesh ref={halo} geometry={haloGeometry} material={haloMaterial} raycast={() => null} />
      <mesh geometry={hitGeometry} material={hitMaterial} userData={{ interactable }} />
      <Billboard ref={text} position={[0, 0.32, 0]}>
        <UIText
          weight={500}
          size={0.09}
          maxWidth={1.6}
          textAlign="center"
          anchorY="bottom"
          outlineWidth={0.006}
          outlineColor="#000000"
          outlineOpacity={0.55}
        >
          {echo.texto}
        </UIText>
        {echo.likes > 0 && (
          <UIText weight={600} size={0.055} opacity={0.65} position={[0, -0.07, 0]} color={ORB_COLOR} outlineWidth={0.004} outlineColor="#000000" outlineOpacity={0.5}>
            {labels.count(echo.likes)}
          </UIText>
        )}
      </Billboard>
    </group>
  );
}
