import './style.css';
import * as THREE from 'three';
import { camera, updateCamera } from './cam.js';
import { loadGrid, updateGrid, getGridColor } from './grid.js';
import { sphere, updateSphere } from './sphere.js';
import { initAudio, getAudioTime, getRealtimeAudio } from './audio.js';
import { initTiming } from './timing.js';
import { initPost, updatePost } from './post.js';

const canvas = document.getElementById('canvas');
const W = 1920, H = 1080;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
scene.add(sphere);

const composer = initPost(renderer, scene, camera, W, H);

function animate(t) {
  requestAnimationFrame(animate);
  const time      = t * 0.001;
  const cycleT    = getAudioTime();
  const audioData = getRealtimeAudio();

  updateCamera(cycleT);
  updateGrid(cycleT, audioData);
  updateSphere(cycleT, camera.position.y, audioData);
  updatePost(audioData, time);

  // Light color follows grid color (white → yellow on sparkle)
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
  initTiming(duration, events);
  requestAnimationFrame(animate);
}, { once: true });
