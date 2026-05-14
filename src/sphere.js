import * as THREE from 'three';
import { timing } from './timing.js';
import { EYE_POSITION } from './eye.js';

const ORBIT_RADIUS = 40;
const BASE_SPEED   = 1.8;
const FADE_DUR     = 0.4;

// Where the pupil sphere settles. Tweak the components to slide it along the
// camera→eye axis. Camera is at (-51, 713, -51), eye center at (0, 700, 0).
// Smaller magnitudes (closer to (0, 700, 0)) push the sphere deeper into the
// eye / further from the camera, so the lids close in front of it.
const SPHERE_END_POS  = new THREE.Vector3(0, 900, 0);

const RED_EMIT    = new THREE.Color(0.5, 0, 0);
const BLACK_EMIT  = new THREE.Color(0, 0, 0);
const YELLOW_EMIT = new THREE.Color(1.0, 0.85, 0.0);
// Yellow ramp duration after glowStart fires (see timing.glowStart).
const YELLOW_RAMP    = 0.5;
// Red glow window (absolute cycleT seconds).
const RED_START_T = 4.0;
const RED_END_T   = 6.0;

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

export function updateSphere(cycleT, camY, audioData, holdT = 0) {
  const { upDelay, upEnd, blinkStart, glowStart, cycle } = timing;

  let dt = cycleT - prevCycleT;
  if (dt < 0) dt += cycle;
  prevCycleT = cycleT;

  material.opacity = Math.max(0, Math.min(1, (cycleT - upDelay) / FADE_DUR));

  const mid  = audioData?.mid  ?? 0;
  const bass = audioData?.bass ?? 0;

  // Convergence runs across the upEnd → blinkStart window: the sphere keeps
  // orbiting while the camera rises, then drifts to the pupil right before the blink.
  const convRaw = Math.max(0, Math.min(1, (cycleT - upEnd) / Math.max(0.01, blinkStart - upEnd)));
  const convT   = 1 - Math.pow(1 - convRaw, 3); // ease-out: orbit dies fast, sphere drifts slowly to pupil

  // Freeze orbit and float motion as sphere converges
  orbitAngle += (BASE_SPEED + mid * 3.5) * dt * (1 - convT);
  floatPhase += FLOAT_SPEED * dt * (1 - convT);

  sphere.scale.setScalar(1.0 + bass * 1.2);

  const floatAmp = 6.0 + bass * 4.0;
  // Cap the orbit's Y at eye level — the sphere rises with the camera but
  // stops climbing once it's level with the eye, so it keeps spinning there
  // until convergence pulls it to the pupil.
  const orbitYCenter = Math.min(camY, EYE_POSITION.y);
  const orbitPos = new THREE.Vector3(
    Math.cos(orbitAngle) * ORBIT_RADIUS,
    orbitYCenter + Math.sin(floatPhase) * floatAmp,
    Math.sin(orbitAngle) * ORBIT_RADIUS,
  );
  sphere.position.lerpVectors(orbitPos, SPHERE_END_POS, convT);

  if (cycleT > glowStart) {
    // Bright yellow after blink — ramp up over YELLOW_RAMP seconds
    const yRaw = Math.min(1, (cycleT - glowStart) / YELLOW_RAMP);
    const yT   = yRaw * yRaw * (3 - 2 * yRaw);
    material.emissive.lerp(YELLOW_EMIT, 0.05 + yT * 0.25);
    material.emissiveIntensity = 1 + yT * 4;
  } else {
    // Red emissive glow active during the [RED_START_T, RED_END_T] window,
    // pulsed by amplitude spikes; fades to black outside the window.
    const inRedWindow = cycleT > RED_START_T && cycleT < RED_END_T;
    const triggerRed  = inRedWindow && (audioData?.amplitude ?? 0) > 0.2;
    material.emissive.lerp(triggerRed ? RED_EMIT : BLACK_EMIT, triggerRed ? 0.04 : 0.012);
    material.emissiveIntensity = 1;
  }
}
