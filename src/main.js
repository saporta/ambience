import './style.css';
import * as THREE from 'three';
import { camera, updateCamera } from './cam.js';
import { loadGrid, updateGrid, getGridColor } from './grid.js';
import { sphere, updateSphere } from './sphere.js';
import { initAudio, getRealtimeAudio, getMonotonicAudioTime, restartAudio } from './audio.js';
import { loadEye, updateEye } from './eye.js';
import { initTiming, computeUpT, timing } from './timing.js';
import { initPost, updatePost } from './post.js';

const canvas = document.getElementById('canvas');
const W = 1920, H = 1080;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

// Grid is the only meaningful light source — point light at base of cylinder
const gridLight   = new THREE.PointLight(0xffffff, 12, 0, 0); // decay=0: no distance falloff
gridLight.position.set(0, 8, 0);
scene.add(gridLight);

// Barely-there ambient so sphere silhouette stays readable in shadow
const ambientLight = new THREE.AmbientLight(0xffffff, 0.04);
scene.add(ambientLight);

loadGrid(scene);
loadEye(scene);
scene.add(sphere);

const composer = initPost(renderer, scene, camera, W, H);

let audioDuration = 0;
const HOLD_SECS   = 3.0; // seconds to hold at end before visual cycle resets
let lastCycleNum  = 0;

function animate(t) {
  requestAnimationFrame(animate);
  const time  = t * 0.001;
  const mono  = getMonotonicAudioTime();
  const visualCycle = audioDuration + HOLD_SECS;
  const cycleNum = audioDuration > 0 ? Math.floor(mono / visualCycle) : 0;
  const rawT     = audioDuration > 0 ? mono % visualCycle : 0;
  const cycleT   = Math.min(rawT, audioDuration);

  // Restart audio from the top each time the visual cycle resets
  if (cycleNum > lastCycleNum) {
    lastCycleNum = cycleNum;
    restartAudio();
  }
  const audioData = getRealtimeAudio();

  const holdT = Math.max(0, rawT - audioDuration); // 0 during audio; 0→HOLD_SECS during hold

  updateCamera(cycleT);
  updateGrid(cycleT, audioData);
  updateSphere(cycleT, camera.position.y, audioData, holdT);
  updateEye(cycleT, camera.position, holdT);

  // CAM_MID → CAM_END progress: drives the static/noise intensification.
  const upT = computeUpT(cycleT);

  // Background fade (black → white): starts BG_DELAY seconds after upDelay,
  // but still finishes at upEnd. Same end time, later start.
  const BG_DELAY = 1.0;
  const bgStart  = timing.upDelay + BG_DELAY;
  const bgRaw    = Math.max(0, Math.min(1, (cycleT - bgStart) / Math.max(0.01, timing.upEnd - bgStart)));
  const bgT      = bgRaw * bgRaw * (3 - 2 * bgRaw); // smoothstep
  scene.background.setScalar(bgT);

  // Once audio ends, fade the whole screen to black over 1s via the post pass.
  const FADE_OUT_DUR = 1.0;
  const fade = 1 - Math.max(0, Math.min(1, holdT / FADE_OUT_DUR));
  updatePost(audioData, time, upT, fade);

  gridLight.color.copy(getGridColor());

  composer.render();
}

const overlay = document.createElement('div');
overlay.style.cssText = [
  'position:fixed', 'inset:0', 'display:flex',
  'align-items:center', 'justify-content:center',
  'font:20px/1 monospace', 'letter-spacing:.2em',
  'color:#fff', 'cursor:pointer', 'z-index:10',
].join(';');
overlay.textContent = 'CLICK TO START';
document.body.appendChild(overlay);

overlay.addEventListener('click', async () => {
  overlay.remove();
  const { duration, events } = await initAudio();
  audioDuration = duration; // used by hold-loop in animate
  initTiming(duration, events);
  requestAnimationFrame(animate);
}, { once: true });