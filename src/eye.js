import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { timing } from './timing.js';

export const EYE_POSITION   = new THREE.Vector3(0, 900, 0);
// Front face of eye at scale=15: center + 15*1.826 units toward camera at CAM_END (-51,713,-51)
export const SPHERE_END_POS = new THREE.Vector3(-4, 901, -4);

const LID_OPEN_ANGLE = Math.PI * 0.5;
// Lids start opening when camera is 45% of the way to CAM_END, fully open at 100%
const LID_THRESHOLD  = 0.45;

// How far to push the eye body (everything except the lids) away from the camera,
// in gltf.scene local-Z units. Larger = eye sits deeper behind the lids.
// Tweak this until the lids visibly close in front of the iris/sphere.
const EYE_BODY_BACK_OFFSET = 2;

// Blink phase durations (seconds). Trigger time lives in timing.blinkStart.
const BLINK_CLOSE = 0.2;
const BLINK_HOLD  = 0.1;
const BLINK_OPEN  = 0.3;

let eyeGroup      = null; // wrapper group — receives lookAt each frame
let topLid        = null;
let bottomLid     = null;
const topLidBaseQuat = new THREE.Quaternion();
const botLidBaseQuat = new THREE.Quaternion();

// Axis for the camera-driven lid opening (t-ramp). Don't change this without
// expecting the open rest pose to move.
const OPEN_AXIS  = new THREE.Vector3(1, 0, 0);
// Axis for the blink itself (the close→hold→open during hold phase).
// Independent from OPEN_AXIS — change this to change only the blink path.
const BLINK_AXIS = new THREE.Vector3(0, -1, 0);
const _openQuat  = new THREE.Quaternion();
const _blinkQuat = new THREE.Quaternion();

export function loadEye(scene) {
  // Wrapper: position + scale live here; lookAt is applied here every frame
  const wrapper = new THREE.Group();
  wrapper.position.copy(EYE_POSITION);
  wrapper.scale.setScalar(25);
  eyeGroup = wrapper;
  scene.add(wrapper);

  new GLTFLoader().load(`${import.meta.env.BASE_URL}eye.glb`, (gltf) => {
    // Roll correction: eye face is along +Z (correct for lookAt) but iris is rolled 90°.
    // Rotating around wrapper's local Z (= camera-facing axis after lookAt) fixes the roll.
    gltf.scene.rotation.z = Math.PI /2;
    wrapper.add(gltf.scene);

    gltf.scene.traverse(child => {
      if (!child.isMesh) return;
      const n = child.name.toLowerCase();
      if (n === 'toplid')       topLid    = child;
      else if (n === 'botlid')  bottomLid = child;
      else                      child.position.z -= EYE_BODY_BACK_OFFSET;
    });

    if (topLid)    topLidBaseQuat.copy(topLid.quaternion);
    if (bottomLid) botLidBaseQuat.copy(bottomLid.quaternion);

    gltf.scene.traverse(child => {
      if (!child.isMesh || !child.material) return;
      child.material = child.material.clone();
      child.material.color             = new THREE.Color(0.08, 0.08, 0.08);
      child.material.emissive          = new THREE.Color(0.12, 0.12, 0.12);
      child.material.emissiveIntensity = 0.7;
      child.material.metalness         = 1.0;
      child.material.roughness         = 0.3;
    });
  });
}

export function updateEye(cycleT, camPos, holdT = 0) {
  if (!eyeGroup) return;

  // Wrapper faces camera; inner mesh's baked rotation handles the +90° axis correction
  eyeGroup.lookAt(camPos);

  const { upDelay, upEnd, blinkStart } = timing;
  const uRaw   = Math.max(0, Math.min(1, (cycleT - upDelay) / (upEnd - upDelay)));
  const uT     = uRaw * uRaw * (3 - 2 * uRaw); // smoothstep, matches cam.js

  const lidRaw = Math.max(0, Math.min(1, (uT - LID_THRESHOLD) / (1 - LID_THRESHOLD)));
  const t      = lidRaw * lidRaw * (3 - 2 * lidRaw);

  const openAngle = t * LID_OPEN_ANGLE;
  let blinkClosure = 0;

  // Blink fires at the absolute cycleT = blinkStart (set in timing.js)
  if (cycleT > blinkStart) {
    const totalBlinkTime = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;
    const blinkProgress = Math.min(1, (cycleT - blinkStart) / totalBlinkTime);

    if (blinkProgress < BLINK_CLOSE / totalBlinkTime) {
      // Closing phase
      blinkClosure = blinkProgress / (BLINK_CLOSE / totalBlinkTime);
    } else if (blinkProgress < (BLINK_CLOSE + BLINK_HOLD) / totalBlinkTime) {
      // Hold closed
      blinkClosure = 1;
    } else {
      // Opening phase
      const openProgress = (blinkProgress - (BLINK_CLOSE + BLINK_HOLD) / totalBlinkTime) / (BLINK_OPEN / totalBlinkTime);
      blinkClosure = 1 - openProgress;
    }
  }

  // Blink walks back along its own axis by the same magnitude the opening
  // ramped — so when blinkClosure = 1 the lid is back at its baked closed pose
  // (along OPEN_AXIS the rotations cancel; when BLINK_AXIS differs, the lid
  // ends up at an alternate closed orientation traversed via a different path).
  const blinkAngle = blinkClosure * openAngle + Math.PI * 0.03;

  if (topLid) {
    _openQuat.setFromAxisAngle(OPEN_AXIS, -openAngle);
    _blinkQuat.setFromAxisAngle(BLINK_AXIS, blinkAngle);
    topLid.quaternion.copy(topLidBaseQuat).premultiply(_openQuat).premultiply(_blinkQuat);
  }
  if (bottomLid) {
    _openQuat.setFromAxisAngle(OPEN_AXIS, openAngle);
    _blinkQuat.setFromAxisAngle(BLINK_AXIS, -blinkAngle);
    bottomLid.quaternion.copy(botLidBaseQuat).premultiply(_openQuat).premultiply(_blinkQuat);
  }
}
