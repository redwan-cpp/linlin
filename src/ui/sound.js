// 8-bit sound effects with WebAudio square waves. Silent until the player interacts.
let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }
export function soundOn() { return enabled; }

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, { type = 'square', vol = 0.06, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, a.currentTime + start + dur);
  g.gain.setValueAtTime(vol, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

const SFX = {
  click: () => tone(660, 0, 0.05, { vol: 0.03 }),
  objective: () => { tone(784, 0, 0.08); tone(1175, 0.08, 0.14); },
  complete: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.12, { vol: 0.07 })),
  wrong: () => tone(196, 0, 0.25, { slide: -80, vol: 0.07, type: 'sawtooth' }),
  hit: () => { tone(110, 0, 0.12, { type: 'triangle', vol: 0.12 }); tone(80, 0.05, 0.15, { type: 'square', vol: 0.05 }); },
  unlock: () => [880, 1109, 1319].forEach((f, i) => tone(f, i * 0.07, 0.1, { vol: 0.05 })),
  quiz: () => tone(988, 0, 0.09, { vol: 0.05 }),
  oracle: () => [440, 554, 659].forEach((f, i) => tone(f, i * 0.12, 0.3, { type: 'triangle', vol: 0.06 })),
};

export function sfx(name) {
  if (!enabled) return;
  try { SFX[name]?.(); } catch { /* audio unavailable */ }
}
