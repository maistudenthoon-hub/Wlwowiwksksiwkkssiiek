/**
 * RIVO Sound Engine — synthesized UI sounds via Web Audio API.
 * No external assets, no latency, no network.
 * Respects prefers-reduced-motion / muted setting.
 */

let ctx: AudioContext | null = null;
let muted = false;
let initialized = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (muted) return null;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function setSoundMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem("rivo-muted", v ? "1" : "0"); } catch {}
}

export function isSoundMuted() {
  return muted;
}

export function initSoundFromStorage() {
  try { muted = localStorage.getItem("rivo-muted") === "1"; } catch {}
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.12,
  slideTo?: number,
) {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 4200;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration * 0.85);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(filter).connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function clickTone() {
  // subtle blip — for hover / generic clicks
  tone(1200, 0.09, "sine", 0.06);
}

function popTone() {
  // chat bubble pop
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.18);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.14, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.22);
}

export const sounds = {
  hover() { if (!initialized) return; clickTone(); },
  tap() { tone(800, 0.07, "sine", 0.08); },
  send() {
    // whoosh — two quick tones rising
    tone(520, 0.12, "sine", 0.11, 880);
    setTimeout(() => tone(880, 0.1, "sine", 0.07, 1200), 55);
  },
  receive() {
    // gentle chime — major third
    tone(660, 0.22, "sine", 0.1);
    setTimeout(() => tone(830, 0.26, "sine", 0.08), 80);
  },
  success() {
    tone(523, 0.14, "sine", 0.11);
    setTimeout(() => tone(659, 0.14, "sine", 0.11), 110);
    setTimeout(() => tone(784, 0.28, "sine", 0.12), 220);
  },
  error() {
    tone(240, 0.18, "sine", 0.11, 180);
    setTimeout(() => tone(180, 0.22, "sine", 0.09), 120);
  },
  typing() {
    // very subtle tick for streaming start
    tone(1000, 0.04, "sine", 0.04);
  },
  switch() {
    tone(700, 0.08, "triangle", 0.07, 900);
  },
};

export function initSound() {
  if (initialized) return;
  initialized = true;
  initSoundFromStorage();
  // Warm AudioContext on first user gesture
  const warm = () => {
    getCtx();
    window.removeEventListener("pointerdown", warm);
    window.removeEventListener("keydown", warm);
  };
  window.addEventListener("pointerdown", warm, { once: true });
  window.addEventListener("keydown", warm, { once: true });
}

// Light haptics where available
export function haptic(style: "light" | "medium" | "heavy" = "light") {
  try {
    const v = style === "heavy" ? 20 : style === "medium" ? 12 : 8;
    (navigator as unknown as { vibrate?: (n: number) => void }).vibrate?.(v);
  } catch {}
}
