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
  uniform vec3  uGridColor;
  varying vec2  vUv;
  varying vec3  vWorldPos;

  const float R_OUTER = 217.2;
  const float R_CYL   = 4.886;
  const float Y_BASE  = 33.0;
  const float Y_TOP   = 400.0;
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

    float bassGlow = 1.0 + uBass * 0.7;
    float alpha    = clamp(grid * covered * fade * bassGlow, 0.0, 1.0);
    gl_FragColor   = vec4(uGridColor, alpha);
  }
`;

const uProgress  = { value: 0.0 };
const uSpin      = { value: 0.0 };
const uBass      = { value: 0.0 };
const uGridColor = { value: new THREE.Color(1, 1, 1) };

const WHITE  = new THREE.Color(1, 1, 1);
const YELLOW = new THREE.Color(1, 1, 0);

export function getGridColor() { return uGridColor.value; }

export function loadGrid(scene) {
  new GLTFLoader().load('/grid.glb', (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.ShaderMaterial({
          uniforms: { uProgress, uSpin, uBass, uGridColor },
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

  // Yellow flash on high-freq spike (sparkle)
  const high   = audioData?.high ?? 0;
  const target = high > 0.75 ? YELLOW : WHITE;
  uGridColor.value.lerp(target, high > 0.75 ? 0.35 : 0.12);
}
