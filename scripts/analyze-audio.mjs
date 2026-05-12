import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const wavPath = resolve(__dir, '../public/deepdeckard.wav');
const outPath = resolve(__dir, '../public/audio-data.json');

const buf = readFileSync(wavPath);

if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
  throw new Error('Not a RIFF WAVE file');

// Walk all chunks after the WAVE type marker
const chunks = {};
let pos = 12;
while (pos < buf.length - 8) {
  const id   = buf.toString('ascii', pos, pos + 4);
  const size = buf.readUInt32LE(pos + 4);
  chunks[id] = { offset: pos + 8, size };
  pos += 8 + size + (size & 1);
}

const fmt  = chunks['fmt '];
const data = chunks['data'];
if (!fmt || !data) throw new Error('Missing fmt or data chunk');

const audioFmt = buf.readUInt16LE(fmt.offset);      // 1=PCM, 3=IEEE_FLOAT
const numCh    = buf.readUInt16LE(fmt.offset + 2);
const sr       = buf.readUInt32LE(fmt.offset + 4);
const bps      = buf.readUInt16LE(fmt.offset + 14);

if (audioFmt !== 1 && audioFmt !== 3)
  throw new Error(`Unsupported WAV format ${audioFmt}`);

const bytesPerSamp = bps / 8;
const totalSamples = Math.floor(data.size / (bytesPerSamp * numCh));
const duration     = totalSamples / sr;

console.log(`Channels:${numCh}  Rate:${sr}  Bits:${bps}  Duration:${duration.toFixed(3)}s`);

function readMono(sampleIdx) {
  let sum = 0;
  const base = data.offset + sampleIdx * bytesPerSamp * numCh;
  for (let c = 0; c < numCh; c++) {
    const o = base + c * bytesPerSamp;
    let v = 0;
    if (audioFmt === 3) {
      v = buf.readFloatLE(o);
    } else if (bps === 16) {
      v = buf.readInt16LE(o) / 32768.0;
    } else if (bps === 24) {
      let raw = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (raw >= 0x800000) raw -= 0x1000000;
      v = raw / 8388608.0;
    } else if (bps === 32) {
      v = buf.readInt32LE(o) / 2147483648.0;
    }
    sum += v;
  }
  return sum / numCh;
}

// FFT size — next power-of-2 >= sr/30 (≈30fps frame)
const FPS      = 30;
const frameLen = Math.floor(sr / FPS);
let fftSize = 1;
while (fftSize < frameLen) fftSize <<= 1;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len >> 1; j++) {
        const uRe = re[i+j], uIm = im[i+j];
        const vRe = re[i+j+(len>>1)]*cRe - im[i+j+(len>>1)]*cIm;
        const vIm = re[i+j+(len>>1)]*cIm + im[i+j+(len>>1)]*cRe;
        re[i+j]         = uRe+vRe;  im[i+j]         = uIm+vIm;
        re[i+j+(len>>1)] = uRe-vRe; im[i+j+(len>>1)] = uIm-vIm;
        const nr = cRe*wRe - cIm*wIm; cIm = cRe*wIm + cIm*wRe; cRe = nr;
      }
    }
  }
}

const binHz = sr / fftSize;
const bEnd  = Math.max(2, Math.ceil(250  / binHz));
const mEnd  = Math.ceil(2000 / binHz);
const hEnd  = Math.ceil(8000 / binHz);

const numFrames = Math.floor(totalSamples / frameLen);
const ampArr  = new Float32Array(numFrames);
const bassArr = new Float32Array(numFrames);
const midArr  = new Float32Array(numFrames);
const highArr = new Float32Array(numFrames);

const re = new Float64Array(fftSize);
const im = new Float64Array(fftSize);

let maxAmp = 0, maxBass = 0, maxMid = 0, maxHigh = 0;

for (let f = 0; f < numFrames; f++) {
  const s0 = f * frameLen;
  let rms = 0;

  for (let i = 0; i < fftSize; i++) {
    const s = (i < frameLen && s0 + i < totalSamples) ? readMono(s0 + i) : 0;
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize)); // Hann
    re[i] = s * w;
    im[i] = 0;
    rms += s * s;
  }
  ampArr[f] = Math.sqrt(rms / frameLen);
  if (ampArr[f] > maxAmp) maxAmp = ampArr[f];

  fft(re, im);

  let b = 0, m = 0, h = 0;
  for (let i = 1; i < bEnd; i++)        b += Math.hypot(re[i], im[i]);
  for (let i = bEnd; i < mEnd; i++)     m += Math.hypot(re[i], im[i]);
  for (let i = mEnd; i < hEnd; i++)     h += Math.hypot(re[i], im[i]);

  bassArr[f] = b / (bEnd - 1);
  midArr[f]  = m / (mEnd - bEnd);
  highArr[f] = h / (hEnd - mEnd);
  if (bassArr[f] > maxBass) maxBass = bassArr[f];
  if (midArr[f]  > maxMid)  maxMid  = midArr[f];
  if (highArr[f] > maxHigh) maxHigh = highArr[f];

  if (f % 500 === 0) process.stdout.write(`\r  analyzing ${f}/${numFrames}`);
}
process.stdout.write('\n');

// Normalize
for (let f = 0; f < numFrames; f++) {
  ampArr[f]  = maxAmp  > 0 ? ampArr[f]  / maxAmp  : 0;
  bassArr[f] = maxBass > 0 ? bassArr[f] / maxBass : 0;
  midArr[f]  = maxMid  > 0 ? midArr[f]  / maxMid  : 0;
  highArr[f] = maxHigh > 0 ? highArr[f] / maxHigh : 0;
}

// Event detection
function firstCross(arr, threshold) {
  for (let f = 0; f < arr.length; f++)
    if (arr[f] >= threshold) return f / FPS;
  return 0;
}
function peakTime(arr) {
  let best = 0;
  for (let f = 1; f < arr.length; f++) if (arr[f] > arr[best]) best = f;
  return best / FPS;
}

const onsetTime = firstCross(ampArr, 0.15);
const bassOnset = firstCross(bassArr, 0.20);
const peakT     = peakTime(ampArr);

console.log(`  onset:${onsetTime.toFixed(2)}s  bassOnset:${bassOnset.toFixed(2)}s  peak:${peakT.toFixed(2)}s`);

// Round to 3 decimals to keep JSON small
const round3 = arr => Array.from(arr).map(v => Math.round(v * 1000) / 1000);

const out = {
  duration,
  sampleRate: sr,
  fps: FPS,
  amplitude: round3(ampArr),
  bass:      round3(bassArr),
  mid:       round3(midArr),
  high:      round3(highArr),
  events: { onset: onsetTime, bassOnset, peak: peakT },
};

writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath} (${numFrames} frames)`);
