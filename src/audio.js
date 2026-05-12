let audioCtx  = null;
let analyser  = null;
let freqData  = null;
let startTime = 0;
let _duration = 0;

export async function initAudio() {
  const [rawBuf, meta] = await Promise.all([
    fetch('/deepdeckard.wav').then(r => r.arrayBuffer()),
    fetch('/audio-data.json').then(r => r.json()),
  ]);

  audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(rawBuf);
  _duration = decoded.duration;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.75;
  freqData = new Uint8Array(analyser.frequencyBinCount);

  const src = audioCtx.createBufferSource();
  src.buffer = decoded;
  src.loop = true;
  src.connect(analyser);
  analyser.connect(audioCtx.destination);

  startTime = audioCtx.currentTime;
  src.start(0);

  return { duration: _duration, events: meta.events };
}

export function getAudioTime() {
  if (!audioCtx) return 0;
  return (audioCtx.currentTime - startTime) % _duration;
}

export function getRealtimeAudio() {
  if (!analyser) return { bass: 0, mid: 0, high: 0, amplitude: 0 };
  analyser.getByteFrequencyData(freqData);

  const binHz = audioCtx.sampleRate / analyser.fftSize;
  const bEnd  = Math.max(2, Math.ceil(250  / binHz));
  const mEnd  = Math.ceil(2000 / binHz);
  const hEnd  = Math.ceil(8000 / binHz);
  const n     = freqData.length;

  let bSum = 0, mSum = 0, hSum = 0;
  for (let i = 1; i < Math.min(bEnd, n); i++) bSum += freqData[i];
  for (let i = bEnd; i < Math.min(mEnd, n); i++) mSum += freqData[i];
  for (let i = mEnd; i < Math.min(hEnd, n); i++) hSum += freqData[i];

  const bass = bSum / ((bEnd - 1) * 255);
  const mid  = mSum / ((mEnd - bEnd) * 255);
  const high = hSum / ((hEnd - mEnd) * 255);

  return { bass, mid, high, amplitude: (bass + mid + high) / 3 };
}
