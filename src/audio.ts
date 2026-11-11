/** Every sound is made on the spot with WebAudio. There are no audio files. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

try {
  muted = localStorage.getItem("whisper:mute") === "1";
} catch {
  /* private window: stay unmuted for this visit */
}

export const isMuted = () => muted;

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem("whisper:mute", m ? "1" : "0");
  } catch {
    /* nothing to do */
  }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
}

/** Browsers only allow sound after a tap or a key. Call this from one. */
export function unlock(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, peak: number, slideTo?: number): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
const note = (n: number) => 262 * 2 ** ((SCALE[n % SCALE.length] ?? 0) / 12);

/** A listener waking: one step up a bright scale each time. */
export function wake(i: number): void {
  tone(note(i), 0, 0.5, "sine", 0.22);
  tone(note(i) * 2, 0.02, 0.3, "triangle", 0.07);
}

/** The sentence leaving: a short breath of noise swept upwards. */
export function whoosh(): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.58);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

/** A listener speaking: one little blip a word, around its own pitch. */
export function babble(pitch: number, wordCount: number): void {
  const n = Math.min(wordCount, 14);
  for (let i = 0; i < n; i++) {
    const f = pitch * (0.86 + Math.random() * 0.4);
    tone(f, i * 0.085, 0.07, "triangle", 0.12, f * (0.9 + Math.random() * 0.25));
  }
}

export function land(pitch: number): void {
  tone(pitch * 0.5, 0, 0.16, "sine", 0.2, pitch * 0.4);
}

/** Careful mode: the check passed, or did not. */
export function verdict(ok: boolean): void {
  if (ok) {
    tone(660, 0, 0.12, "sine", 0.16);
    tone(990, 0.09, 0.2, "sine", 0.16);
  } else {
    tone(330, 0, 0.14, "square", 0.06);
    tone(247, 0.12, 0.24, "square", 0.06);
  }
}

export function finale(): void {
  [0, 2, 4, 5, 7].forEach((n, i) => tone(note(n), i * 0.09, 0.9, "sine", 0.15));
  tone(note(7) * 2, 0.5, 1.1, "triangle", 0.06);
}

export function tap(): void {
  tone(880, 0, 0.05, "sine", 0.08);
}
