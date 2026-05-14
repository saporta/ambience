import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { timing } from './timing.js';

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uProgress;
  uniform float uSpin;
  uniform float uBass;
  uniform float uFlash;
  uniform float uHigh;
  uniform vec3  uGridColor;
  varying vec2  vUv;
  varying vec3  vWorldPos;

  const float R_OUTER = 217.2;
  const float R_CYL   = 4.886;
  const float Y_BASE  = 33.0;
  const float Y_TOP   = 700.0;
  const float DISC_W  = 0.7;

  void main() {
    float worldR = length(vWorldPos.xz);
    float worldY = vWorldPos.y;

    float discFlow = (1.0 - clamp((worldR - R_CYL) / (R_OUTER - R_CYL), 0.0, 1.0)) * DISC_W;
    float cylFlow  = DISC_W + clamp((Y_BASE - worldY) / (Y_BASE - Y_TOP), 0.0, 1.0) * (1.0 - DISC_W);
    float onCyl    = smoothstep(Y_BASE - 1.0, Y_BASE + 1.0, worldY);
    float flow     = mix(discFlow, cylFlow, onCyl);

    float covered = 1.0 - smoothstep(uProgress - 0.015, uProgress + 0.015, flow);

    float angle  = atan(vWorldPos.z, vWorldPos.x) / 6.28318 + 0.5;
    float lineW  = 0.97 - uBass * 0.04;
    float gU     = step(lineW, fract((angle + uSpin / 6.28318) * 16.0));
    float gV     = step(lineW, fract(flow * 70.0));
    float grid   = max(gU, gV);

    float outerFade = smoothstep(-0.05, 0.35, flow);
    float topFade   = smoothstep(1.0, 0.96, flow);
    float fade      = outerFade * topFade;

    float bassGlow = 1.0 + uBass * 0.7 + uFlash * 5.5 + uHigh * 1.6;
    float alpha    = clamp(grid * covered * fade * bassGlow, 0.0, 1.0);
    gl_FragColor   = vec4(uGridColor, alpha);
  }
`;

const uProgress  = { value: 0.0 };
const uSpin      = { value: 0.0 };
const uBass      = { value: 0.0 };
const uFlash     = { value: 0.0 };
const uHigh      = { value: 0.0 };
const uGridColor = { value: new THREE.Color(1, 1, 1) };

const WHITE  = new THREE.Color(1, 1, 1);
const YELLOW = new THREE.Color(1, 1, 0);
const CYAN   = new THREE.Color(1.0, 0.85, 0.0);

// Sharp cyan grid flash window (absolute cycleT seconds).
const CYAN_FLASH_START = 1.0;
const CYAN_FLASH_END   = 1.5;

export function getGridColor() { return uGridColor.value; }

export function loadGrid(scene) {
  new GLTFLoader().load(`${import.meta.env.BASE_URL}grid.glb`, (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.ShaderMaterial({
          uniforms: { uProgress, uSpin, uBass, uFlash, uHigh, uGridColor },
          vertexShader,
          fragmentShader,
          transparent: true,
          side: THREE.FrontSide,
          depthWrite: false,
        });
      }
    });
    scene.add(gltf.scene);
  });
}

export function updateGrid(cycleT, audioData) {
  const { fillSecs, spinDelay, spinAccel } = timing;

  uProgress.value = Math.min(cycleT / fillSecs, 1.0);

  const spinT = Math.max(0, cycleT - spinDelay);
  uSpin.value = spinAccel * spinT * spinT * spinT;

  // Smooth bass for line glow
  const bass = audioData?.bass ?? 0;
  uBass.value += (bass - uBass.value) * 0.15;

  // Smooth high for sparkle — drives both alpha boost and yellow color blend
  const high = audioData?.high ?? 0;
  uHigh.value += (high - uHigh.value) * 0.28;

  // Cyan flash: smoothstepped window with soft 0.15s ramps at each edge,
  // then low-pass filtered for a natural in/out instead of a hard cut.
  const ramp        = 0.15;
  const dur         = CYAN_FLASH_END - CYAN_FLASH_START;
  const inside      = cycleT >= CYAN_FLASH_START && cycleT < CYAN_FLASH_END;
  let flashTarget   = 0;
  if (inside) {
    const tIn  = Math.min(1, (cycleT - CYAN_FLASH_START) / ramp);
    const tOut = Math.min(1, (CYAN_FLASH_END  - cycleT) / ramp);
    const a    = Math.min(tIn, tOut, dur > ramp * 2 ? 1 : 0.7);
    flashTarget = a * a * (3 - 2 * a);
  }
  uFlash.value += (flashTarget - uFlash.value) * 0.30;

  // Sparkle color: white at rest, eased toward yellow as smoothed high-freq energy rises.
  const sparkleAmt = Math.max(0, Math.min(1, (uHigh.value - 0.35) / 0.55));
  uGridColor.value.copy(WHITE).lerp(YELLOW, sparkleAmt);

  // Cyan blends on top of the audio-driven color
  uGridColor.value.lerp(CYAN, uFlash.value);
}
