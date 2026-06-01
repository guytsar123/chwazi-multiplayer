// Synthesized audio (no samples). Each held finger plays a sustained tone on a
// pentatonic scale so any combination sounds consonant — the "jam session" feel.
// The user can choose between several SOUND PACKS (different timbres + reveal
// sounds); the choice is per-device and persisted. The pick fires a reveal sound.
//
// The AudioContext must be created/resumed inside a user gesture (first touch /
// tapping a preview), so call `unlock()` from a pointer handler before playing.

let ctx = null;
let master = null;
let muted = false;
const voices = new Map(); // key -> voice

// C major pentatonic across two octaves — consonant in any combination.
const SCALE = [
  261.63, 293.66, 329.63, 392.0, 440.0, // C4 D4 E4 G4 A4
  523.25, 587.33, 659.25, 783.99, 880.0, // C5 D5 E5 G5 A5
];
export const noteFor = (i) => SCALE[((i % SCALE.length) + SCALE.length) % SCALE.length];

// Sound packs. `oct` shifts the held tones, `second` adds a second oscillator
// (frequency multiplier) for richness, `reveal` selects the pick sound.
const PACKS = {
  warm: { label: "חמים", wave: "triangle", cutoff: 1300, vib: 5, gain: 0.13, oct: 1, second: null, reveal: "bell" },
  glass: { label: "זכוכית", wave: "sine", cutoff: 3000, vib: 6, gain: 0.12, oct: 2, second: 2.0, reveal: "shimmer" },
  marimba: { label: "מרימבה", wave: "sine", cutoff: 2200, vib: 0, gain: 0.16, oct: 1, second: 2.0, reveal: "chime" },
  retro: { label: "רטרו", wave: "square", cutoff: 1700, vib: 0, gain: 0.07, oct: 1, second: null, reveal: "arp" },
  deep: { label: "עמוק", wave: "sawtooth", cutoff: 700, vib: 3.5, gain: 0.09, oct: 0.5, second: null, reveal: "sweep" },
};
export const SOUND_PACKS = Object.entries(PACKS).map(([id, p]) => ({ id, label: p.label }));

let packId = (typeof localStorage !== "undefined" && localStorage.getItem("chwazi_sound")) || "warm";
if (!PACKS[packId]) packId = "warm";
export const getPack = () => packId;
export function setPack(id) {
  if (!PACKS[id]) return;
  packId = id;
  try {
    localStorage.setItem("chwazi_sound", id);
  } catch {
    /* ignore */
  }
}
const curPack = () => PACKS[packId];

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
  if (ctx && master) master.gain.linearRampToValueAtTime(on ? 0.0001 : 0.85, ctx.currentTime + 0.05);
}
export const isMuted = () => muted;

// ---- low-level held voice -----------------------------------------------
function makeVoice(baseFreq, pack) {
  const now = ctx.currentTime;
  const freq = baseFreq * pack.oct;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(pack.gain, now + 0.12);
  env.connect(master);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = pack.cutoff;
  filter.Q.value = 0.7;
  filter.connect(env);

  const nodes = [];
  const addOsc = (f, g) => {
    const o = ctx.createOscillator();
    o.type = pack.wave;
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = g;
    o.connect(og).connect(filter);
    if (pack.vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = pack.vib;
      const lg = ctx.createGain();
      lg.gain.value = 3;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(now);
      nodes.push(lfo);
    }
    o.start(now);
    nodes.push(o);
  };
  addOsc(freq, 1);
  if (pack.second) addOsc(freq * pack.second, 0.5);

  return {
    stop() {
      const t = ctx.currentTime;
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(env.gain.value, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      nodes.forEach((n) => {
        try {
          n.stop(t + 0.3);
        } catch {
          /* ignore */
        }
      });
    },
  };
}

export function startTone(key, freq) {
  if (!ctx || muted || voices.has(key)) return;
  voices.set(key, makeVoice(freq, curPack()));
}
export function stopTone(key) {
  const v = voices.get(key);
  if (!v) return;
  voices.delete(key);
  v.stop();
}
export function stopAllTones() {
  for (const key of [...voices.keys()]) stopTone(key);
}

// ---- reveal sounds (per pack) -------------------------------------------
function blip(freq, wave, when, dur, peak) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function bell(root) {
  const now = ctx.currentTime;
  const partials = [
    { r: 1.0, g: 0.5, d: 1.6 },
    { r: 2.01, g: 0.26, d: 1.2 },
    { r: 3.0, g: 0.15, d: 0.9 },
    { r: 4.16, g: 0.1, d: 0.7 },
  ];
  for (const p of partials) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = root * p.r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(p.g, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + p.d);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + p.d + 0.1);
  }
}

function sweep() {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.5);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(4000, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  o.connect(f).connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.75);
}

function revealFor(pack) {
  switch (pack.reveal) {
    case "bell":
      return bell(659.25);
    case "chime":
      return bell(880);
    case "shimmer":
      [987.77, 1318.51, 1567.98, 1975.53].forEach((f, i) => blip(f, "sine", i * 0.07, 0.5, 0.18));
      return;
    case "arp":
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(f, "square", i * 0.07, 0.18, 0.12));
      return;
    case "sweep":
      return sweep();
    default:
      return bell(659.25);
  }
}

export function playReveal() {
  if (!ctx || muted) return;
  revealFor(curPack());
}

// Preview a pack: select it, play a few staggered notes, then its reveal sound.
export function previewPack(id) {
  if (!PACKS[id]) return;
  setPack(id);
  unlock();
  if (!ctx) return;
  const pack = PACKS[id];
  const wasMuted = muted;
  if (muted) setMuted(false); // let the preview be heard even if muted
  [0, 2, 4].forEach((si, i) => {
    const v = makeVoice(SCALE[si], pack);
    setTimeout(() => v.stop(), 350 + i * 120);
  });
  setTimeout(() => {
    revealFor(pack);
    if (wasMuted) setTimeout(() => setMuted(true), 800);
  }, 520);
}
