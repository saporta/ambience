import * as THREE from 'three';
import { timing } from './timing.js';

const ORBIT_RADIUS = 40;
const BASE_SPEED   = 1.8;
const FADE_DUR     = 0.4;

const RED_EMIT   = new THREE.Color(0.5, 0, 0);
const BLACK_EMIT = new THREE.Color(0, 0, 0);

const material = new THREE.MeshStandardMaterial({
  color:     new THREE.Color(0.12, 0.12, 0.12),
  metalness: 0.45,
  roughness: 0.45,
  transparent: true,
  opacity: 0,
});

export const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(5, 24, 24),
  material,
);

const FLOAT_SPEED = 0.9; // ~7 s period

let orbitAngle = 0;
let floatPhase = 0;
let prevCycleT = 0;

export function updateSphere(cycleT, camY, audioData) {
  const { upDelay, cycle } = timing;

  let dt = cycleT - prevCycleT;
  if (dt < 0) dt += cycle;
  prevCycleT = cycleT;

  material.opacity = Math.max(0, Math.min(1, (cycleT - upDelay) / FADE_DUR));

  const mid = audioData?.mid ?? 0;
  orbitAngle += (BASE_SPEED + mid * 3.5) * dt;
  floatPhase += FLOAT_SPEED * dt;

  sphere.scale.setScalar(1.0 + (audioData?.bass ?? 0) * 1.2);

  const floatAmp = 6.0 + (audioData?.bass ?? 0) * 4.0;
  sphere.position.set(
    Math.cos(orbitAngle) * ORBIT_RADIUS,
    camY + Math.sin(floatPhase) * floatAmp,
    Math.sin(orbitAngle) * ORBIT_RADIUS,
  );

  // Subtle red emissive glow near end of cycle on amplitude spikes
  const nearEnd    = cycleT > cycle * 0.72;
  const triggerRed = nearEnd && (audioData?.amplitude ?? 0) > 0.38;
  material.emissive.lerp(triggerRed ? RED_EMIT : BLACK_EMIT, triggerRed ? 0.04 : 0.012);
}
