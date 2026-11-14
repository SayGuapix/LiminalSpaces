// ==========================================
// Sun.tsx - LUZ PRINCIPAL Y SOMBRAS HORNEADAS
// ==========================================
// La luz direccional principal del mundo, y además proyecta sombras:
//
// - Solo proyecta sombra el mundo (casas, cercas, torre y faroles) y solo la recibe.
// - Como nada de eso se mueve, el mapa de sombras se dibuja unos pocos frames al
//   montar (para cuando ya están colocadas las instancias) y después no se
//   vuelve a dibujar: las sombras no cuestan nada por frame.
// - El tamaño del mapa depende del nivel de calidad; con 0 no hay sombras.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SUN_DIRECTION } from "./worldMaterials";

/** Centro del mapa: el mapa de sombras lo cubre todo desde aquí. */
const CENTER = new THREE.Vector3(12, 0, 6);
/** Medio lado del área con sombras (las casas más lejanas están a unos 60 m del centro). */
const HALF_SIZE = 95;
const DISTANCE = 120;
/** Frames en que se redibuja el mapa de sombras tras montar o cambiar de calidad. */
const BAKE_FRAMES = 20;

export default function Sun({ intensity, shadowMapSize }: { intensity: number; shadowMapSize: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const gl = useThree((state) => state.gl);
  const bakeLeft = useRef(BAKE_FRAMES);

  // Las sombras solo se dibujan cuando se pide (ver useFrame).
  useEffect(() => {
    const previous = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = previous;
    };
  }, [gl]);

  useEffect(() => {
    const sun = light.current;
    if (!sun) return;
    sun.position.copy(CENTER).addScaledVector(SUN_DIRECTION, DISTANCE);
    sun.target.position.copy(CENTER);
    sun.target.updateMatrixWorld();

    sun.castShadow = shadowMapSize > 0;
    if (shadowMapSize > 0) {
      const shadow = sun.shadow;
      shadow.mapSize.set(shadowMapSize, shadowMapSize);
      // El mapa anterior tenía otro tamaño: three crea uno nuevo.
      shadow.map?.dispose();
      shadow.map = null;
      const cam = shadow.camera;
      cam.left = -HALF_SIZE;
      cam.right = HALF_SIZE;
      cam.top = HALF_SIZE;
      cam.bottom = -HALF_SIZE;
      cam.near = 1;
      cam.far = DISTANCE * 2.2;
      cam.updateProjectionMatrix();
      shadow.bias = -0.0004;
      shadow.normalBias = 0.06;
      shadow.radius = 3;
    }
    bakeLeft.current = BAKE_FRAMES;
  }, [shadowMapSize]);

  useFrame(() => {
    if (bakeLeft.current <= 0) return;
    bakeLeft.current--;
    gl.shadowMap.needsUpdate = true;
  });

  return <directionalLight ref={light} intensity={intensity} />;
}
