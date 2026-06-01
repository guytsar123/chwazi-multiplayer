// Chwazi-style synthesized audio (no samples). Each held finger plays a warm,
// sustained tone on a pentatonic scale so any combination of fingers sounds
// consonant — the "jam session" feel of the original. The pick fires a soft
// bell chime. Everything routes through one master gain so it can be muted.
//
// The AudioContext must be created/resumed inside a user gesture (first touch),
// so call `unlock()` from a pointerdown handler before playing anything.

let ctx = null;
let master = null;
let muted = false;
const voices = new Map(); // key -> { osc, lfo, env }

// C major pentatonic across two octaves — consonant in any combination.
const SCALE = [
  261.63, 293.66, 329.63, 392.0, 440.0, // C4 D4 E4 G4 A4
  523.25, 587.33, 659.25, 783.99, 880.0, // C5 D5 E5 G5 A5
];
export const noteFor = (index) => SCALE[((index % SCALE.length) + SCALE.length) % SCALE.length];

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0.0001 : 0.85;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

export function setMuted(on) {
  muted = on;
  if (!ctx || !master) return;
  master.gain.linearRampToValueAtTime(on ? 0.0001 : 0.85, ctx.currentTime + 0.05);
}
export const isMuted = () => muted;

// Start a sustained warm tone for `key` (e.g. a playerId). Idempotent per key.
export function startTone(key, freq) {
  if (!ctx || muted) return;
  if (voices.has(key)) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;

  // gentle vibrato for a living "hum"
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 3;
  lfo.connect(lfoGain).connect(osc.frequency);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1300;
  filter.Q.value = 0.7;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.13, now + 0.12); // soft attack

  osc.connect(filter).connect(env).connect(master);
  osc.start(now);
  lfo.start(now);
  voices.set(key, { osc, lfo, env });
}

export function stopTone(key) {
  const v = voices.get(key);
  if (!v || !ctx) return;
  voices.delete(key);
  const now = ctx.currentTime;
  v.env.gain.cancelScheduledValues(now);
  v.env.gain.setValueAtTime(v.env.gain.value, now);
  v.env.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  v.osc.stop(now + 0.3);
  v.lfo.stop(now + 0.3);
}

export function stopAllTones() {
  for (const key of [...voices.keys()]) stopTone(key);
}

// Soft synthesized bell for the reveal (inharmonic sine partials, long decay).
export function playReveal(rootFreq = 659.25 /* E5 */) {
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  const partials = [
    { ratio: 1.0, gain: 0.5, decay: 1.6 },
    { ratio: 2.01, gain: 0.26, decay: 1.2 },
    { ratio: 3.0, gain: 0.15, decay: 0.9 },
    { ratio: 4.16, gain: 0.1, decay: 0.7 },
  ];
  for (const p of partials) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = rootFreq * p.ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(p.gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
    osc.connect(g).connect(master);
    osc.start(now);
    osc.stop(now + p.decay + 0.1);
  }
}

// Tiny downward blip for reset / new round.
export function playReset() {
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.1, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.25);
}
