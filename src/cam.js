import * as THREE from 'three';
import { timing } from './timing.js';

export const camera = new THREE.PerspectiveCamera(70, 1920 / 1080, 0.1, 500);
camera.position.set(-100, 20, -100);
camera.lookAt(0, 5, 0);

const CAM_START  = camera.position.clone();
const camForward = new THREE.Vector3();
camera.getWorldDirection(camForward);

const CAM_MID = CAM_START.clone().addScaledVector(camForward, 70);
const CAM_END = CAM_MID.clone().add(new THREE.Vector3(0, 900, 0));

const _tmp = new THREE.Vector3();

export function updateCamera(cycleT) {
  const { fwdDelay, fwdDur, upDelay, upEnd } = timing;

  const fRaw = Math.max(0, Math.min(1, (cycleT - fwdDelay) / fwdDur));
  const fT   = fRaw * fRaw * (3 - 2 * fRaw);

  const uRaw = Math.max(0, Math.min(1, (cycleT - upDelay) / (upEnd - upDelay)));
  const uT   = uRaw * uRaw * (3 - 2 * uRaw); // smoothstep: eases in AND out of CAM_END

  _tmp.lerpVectors(CAM_START, CAM_MID, fT);
  camera.position.lerpVectors(_tmp, CAM_END, uT);
}
