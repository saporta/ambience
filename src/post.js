import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';

// 4×4 Bayer ordered-dither matrix (standard, 0–255)
const _bayerData = new Uint8Array([
    0, 128,  32, 160,
  192,  64, 224,  96,
   48, 176,  16, 144,
  240, 112, 208,  80,
]);
const bayerTex = new THREE.DataTexture(_bayerData, 4, 4, THREE.RedFormat);
bayerTex.magFilter = THREE.NearestFilter;
bayerTex.minFilter = THREE.NearestFilter;
bayerTex.wrapS     = THREE.RepeatWrapping;
bayerTex.wrapT     = THREE.RepeatWrapping;
bayerTex.needsUpdate = true;

const DistortionShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uBayer:     { value: bayerTex },
    uTime:      { value: 0 },
    uAmplitude: { value: 0 },
    uBass:      { value: 0 },
    uHigh:      { value: 0 },
    uMid:       { value: 0 },
    uNoise:     { value: 0 }, // 0..1, intensifies static during CAM_MID→CAM_END
    uFade:      { value: 1 }, // 1=full color, 0=black (fade-out after audio ends)
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D uBayer;
    uniform float uTime;
    uniform float uAmplitude;
    uniform float uBass;
    uniform float uHigh;
    uniform float uMid;
    uniform float uNoise;
    uniform float uFade;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;

      // ── UV DISTORTIONS (before sampling) ──────────────────────────

      // CRT barrel warp
      vec2 p  = uv * 2.0 - 1.0;
      p *= 1.0 + dot(p, p) * (0.012 + uAmplitude * 0.018);
      uv = p * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // VHS per-line horizontal jitter (subtle tape instability)
      float lineY   = floor(uv.y * 1080.0);
      uv.x += (hash(vec2(lineY, floor(uTime * 6.0))) * 2.0 - 1.0) * 0.0007;

      // VHS head-switch: bottom ~5% warps hard
      float switchZone = 1.0 - smoothstep(0.0, 0.05, uv.y);
      uv.x += (hash(vec2(floor(uv.y * 200.0), floor(uTime * 30.0))) * 2.0 - 1.0)
              * switchZone * 0.030;

      // Glitch blocks (bass-driven, kept modest)
      float blockY = floor(uv.y * 40.0 + uTime * 4.0);
      float gn     = hash(vec2(blockY, floor(uTime * 3.0)));
      if (gn > (1.0 - uBass * 0.28)) {
        uv.x += (hash(vec2(blockY, 7.1)) * 2.0 - 1.0) * 0.018 * uBass;
      }

      // ── SAMPLING ──────────────────────────────────────────────────

      // Chromatic aberration — original strength, with a fast pulse that
      // only kicks in as uNoise (CAM_MID→CAM_END progress) ramps to 1.
      float caPulse = 0.5 + 0.5 * sin(uTime * 14.0);
      float ca = 0.001 + uAmplitude * 0.007 + uMid * 0.004 + (uNoise* 0.3) * caPulse * 0.030;
      float r  = texture2D(tDiffuse, uv + vec2( ca, 0.0)).r;
      float g  = texture2D(tDiffuse, uv             ).g;
      float b  = texture2D(tDiffuse, uv - vec2( ca, 0.0)).b;
      vec3 col = vec3(r, g, b);

      // VHS Y/C chroma smear — colour bleeds right (limited chroma bandwidth)
      vec3 smear = texture2D(tDiffuse, uv + vec2(0.008, 0.0)).rgb;
      col.gb = mix(col.gb, smear.gb, 0.38);

      // ── POST-SAMPLE EFFECTS ───────────────────────────────────────

      // VHS tracking band: one noisy strip scrolling upward
      float trackPos  = fract(uTime * 0.09);
      float trackDist = abs(fract(vUv.y - trackPos + 0.5) - 0.5);
      float trackMask = 1.0 - smoothstep(0.0, 0.007, trackDist);
      col = mix(col, vec3(hash(vec2(vUv.x * 500.0, uTime * 60.0)) * 0.7), trackMask * 0.55);

      // Scanlines
      col *= 1.0 - 0.055 * step(0.5, fract(vUv.y * 270.0));

      // Grain (high-freq)
      col += (hash(uv + fract(uTime * 0.29)) * 2.0 - 1.0) * uHigh * 0.07;

      // Climax static — heavy noise field that intensifies via uNoise (CAM_MID→CAM_END)
      float climaxN = hash(uv * 1.8 + fract(uTime * 13.7)) * 2.0 - 1.0;
      col += climaxN * uNoise * 0.5;

      // VHS warm grade: slight yellowing + 12 % desaturation
      col.r *= 1.05;
      col.b *= 0.87;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), 0.12);

      // Vignette
      float vig = 1.0 - smoothstep(0.40, 0.82, length(vUv - 0.5));
      col *= mix(1.0, vig, 0.50);

      // Bayer dither — 8 levels (ramped up from 16)
      float threshold = texture2D(uBayer, gl_FragCoord.xy / 4.0).r;
      float levels    = 8.0;
      col.r = floor(col.r * levels + threshold) / levels;
      col.g = floor(col.g * levels + threshold) / levels;
      col.b = floor(col.b * levels + threshold) / levels;

      gl_FragColor = vec4(clamp(col * uFade, 0.0, 1.0), 1.0);
    }
  `,
};

let composer;
let distPass;

export function initPost(renderer, scene, camera, W, H) {
  composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  distPass = new ShaderPass(DistortionShader);
  composer.addPass(distPass);
  return composer;
}

const _s = { amp: 0, bass: 0, high: 0, mid: 0 };

export function updatePost(audioData, time, noise = 0, fade = 1) {
  _s.amp  += ((audioData?.amplitude ?? 0) - _s.amp)  * 0.18;
  _s.bass += ((audioData?.bass      ?? 0) - _s.bass) * 0.14;
  _s.high += ((audioData?.high      ?? 0) - _s.high) * 0.28;
  _s.mid  += ((audioData?.mid       ?? 0) - _s.mid)  * 0.20;

  const u = distPass.uniforms;
  u.uTime.value      = time;
  u.uAmplitude.value = _s.amp;
  u.uBass.value      = _s.bass;
  u.uHigh.value      = _s.high;
  u.uMid.value       = _s.mid;
  u.uNoise.value     = noise;
  u.uFade.value      = fade;
}
