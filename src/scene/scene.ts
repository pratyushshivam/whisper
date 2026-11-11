/**
 * The stage: one canvas. Every listener is a small crowd of dots sprung to a
 * silhouette; the sentence is a stream of dots thrown from one to the next.
 * Nothing here touches the DOM per frame apart from the canvas itself.
 */
import { LISTENERS, type ShapeId } from "../core/listeners";
import { dotsFor, FACES } from "./shapes";

const INK = "#0a0e3d";
const SLEEP = [154, 166, 255] as const;

interface Body {
  id: string;
  name: string;
  shape: ShapeId | "you";
  rgb: [number, number, number];
  home: Float32Array;
  px: Float32Array;
  py: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  phase: Float32Array;
  /** Centre now, and where it is heading. */
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  /** 0 off stage, 1 on the ring. */
  on: number;
  onTarget: number;
  awake: number;
  awakeTarget: number;
  talk: number;
  talkTarget: number;
  think: number;
  thinkTarget: number;
  shake: number;
  blink: number;
  nextBlink: number;
  lookX: number;
  lookY: number;
  placed: boolean;
}

interface Mote {
  from: number;
  to: number;
  t0: number;
  dur: number;
  ox: number;
  oy: number;
  bend: number;
  size: number;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: readonly number[], b: readonly number[], t: number) =>
  `rgb(${Math.round(a[0]! + (b[0]! - a[0]!) * t)},${Math.round(a[1]! + (b[1]! - a[1]!) * t)},${Math.round(a[2]! + (b[2]! - a[2]!) * t)})`;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export interface Ring {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  r: number;
  /** Room for the panel in the middle. */
  innerW: number;
  innerH: number;
  phone: boolean;
}

/** Where the ring sits in a stage of this size. Shared with the page's layout. */
export function ringFor(w: number, h: number): Ring {
  const phone = w < 700;
  const r = phone ? Math.max(20, Math.min(30, w * 0.066)) : Math.max(28, Math.min(46, Math.min(w, h) * 0.056));
  const rx = phone ? w / 2 - r - 10 : Math.min(w / 2 - r - 56, h * 0.98, 620);
  const ry = h / 2 - r - (phone ? 26 : 34);
  return {
    cx: w / 2,
    cy: h / 2 + (phone ? 2 : 4),
    rx,
    ry,
    r,
    innerW: Math.min(2 * rx - 2 * r - (phone ? 30 : 110), 560),
    innerH: 2 * ry - 2 * r - (phone ? 70 : 90),
    phone,
  };
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private bodies: Body[] = [];
  private byId = new Map<string, Body>();
  private motes: Mote[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  ring: Ring = ringFor(1200, 800);
  private line: string[] = [];
  private pointer = { x: -9999, y: -9999, active: false };
  private selected = "";
  private speaker = "";
  private tail: { x: number; y: number; w: number; h: number } | null = null;
  private running = false;
  private visible = true;
  private last = 0;
  private time = 0;
  private stars: Float32Array;
  reduced = false;
  /** Called when a stream lands on a listener. */
  onArrive: ((id: string) => void) | null = null;
  private arrivals: { at: number; id: string }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const step = small ? 0.235 : 0.2;
    const make = (id: string, name: string, shape: ShapeId | "you", colour: string): Body => {
      const home = dotsFor(shape, shape === "you" ? step * 0.92 : step);
      const n = home.length / 2;
      const phase = new Float32Array(n);
      for (let i = 0; i < n; i++) phase[i] = Math.random() * Math.PI * 2;
      return {
        id, name, shape, rgb: hexToRgb(colour), home,
        px: new Float32Array(n), py: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), phase,
        cx: 0, cy: 0, tx: 0, ty: 0, on: 0, onTarget: 0, awake: 0, awakeTarget: 0, talk: 0, talkTarget: 0,
        think: 0, thinkTarget: 0, shake: 0, blink: 0, nextBlink: 1 + Math.random() * 4, lookX: 0, lookY: 0, placed: false,
      };
    };
    this.bodies.push(make("you", "You", "you", "#ffffff"));
    for (const l of LISTENERS) this.bodies.push(make(l.id, l.name.replace(/^The /, ""), l.shape, l.colour));
    for (const b of this.bodies) this.byId.set(b.id, b);
    this.byId.get("you")!.awake = this.byId.get("you")!.awakeTarget = 1;
    this.stars = new Float32Array(70 * 3);
    for (let i = 0; i < 70; i++) {
      this.stars[i * 3] = Math.random();
      this.stars[i * 3 + 1] = Math.random();
      this.stars[i * 3 + 2] = 0.4 + Math.random() * 0.6;
    }

    const move = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = e.clientX - rect.left;
      this.pointer.y = e.clientY - rect.top;
      this.pointer.active = true;
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    const gone = () => (this.pointer.active = false);
    window.addEventListener("pointerup", (e) => e.pointerType !== "mouse" && gone(), { passive: true });
    document.addEventListener("pointerleave", gone);
    document.addEventListener("visibilitychange", () => this.wake());
    new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting ?? true;
      this.wake();
    }).observe(canvas);
  }

  /** Match the canvas to its box. Called from a ResizeObserver, never per frame. */
  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ring = ringFor(w, h);
    this.place();
    this.wake();
  }

  /** Who stands on the ring, in order. "you" is always first, at the top. */
  setLine(ids: string[]): void {
    this.line = ["you", ...ids];
    for (const b of this.bodies) b.onTarget = this.line.includes(b.id) ? 1 : 0;
    this.place();
  }

  private place(): void {
    const { cx, cy, rx, ry } = this.ring;
    const n = this.line.length;
    this.line.forEach((id, k) => {
      const b = this.byId.get(id)!;
      const a = -Math.PI / 2 + (Math.PI * 2 * k) / n;
      b.tx = cx + rx * Math.cos(a);
      b.ty = cy + ry * Math.sin(a);
      if (!b.placed || this.reduced) {
        b.cx = b.tx;
        b.cy = b.ty;
        this.scatter(b, b.placed ? 0 : 2.4);
        b.placed = true;
      }
    });
  }

  private scatter(b: Body, spread: number): void {
    const R = this.ring.r;
    for (let i = 0; i < b.px.length; i++) {
      b.px[i] = b.cx + b.home[i * 2]! * R * (1 + spread * Math.random());
      b.py[i] = b.cy + b.home[i * 2 + 1]! * R * (1 + spread * Math.random());
      b.vx[i] = 0;
      b.vy[i] = 0;
    }
  }

  centreOf(id: string): { x: number; y: number } {
    const b = this.byId.get(id);
    return b ? { x: b.tx, y: b.ty } : { x: 0, y: 0 };
  }

  setAwake(id: string, awake: boolean): void {
    const b = this.byId.get(id);
    if (b) b.awakeTarget = awake ? 1 : 0;
  }
  isAwake(id: string): boolean {
    return (this.byId.get(id)?.awakeTarget ?? 0) === 1;
  }
  setTalking(id: string, on: boolean): void {
    const b = this.byId.get(id);
    if (b) b.talkTarget = on ? 1 : 0;
  }
  setThinking(id: string, on: boolean): void {
    const b = this.byId.get(id);
    if (b) b.thinkTarget = on ? 1 : 0;
  }
  shake(id: string): void {
    const b = this.byId.get(id);
    if (b) b.shake = 1;
  }
  /** A little jump, as when something lands or the listener wakes. */
  bump(id: string, power = 1): void {
    const b = this.byId.get(id);
    if (!b || this.reduced) return;
    const R = this.ring.r;
    for (let i = 0; i < b.px.length; i++) {
      const hx = b.home[i * 2]!;
      const hy = b.home[i * 2 + 1]!;
      b.vx[i]! += hx * R * 0.16 * power + (Math.random() - 0.5) * 2 * power;
      b.vy[i]! += hy * R * 0.16 * power + (Math.random() - 0.5) * 2 * power;
    }
  }
  setSelected(id: string): void {
    this.selected = id;
  }
  /** Who the bubble belongs to, and the bubble's box in stage coordinates. */
  setSpeaker(id: string, box: { x: number; y: number; w: number; h: number } | null): void {
    this.speaker = id;
    this.tail = box;
  }
  quiet(): void {
    for (const b of this.bodies) {
      b.talkTarget = 0;
      b.thinkTarget = 0;
    }
    this.speaker = "";
    this.tail = null;
    this.motes.length = 0;
    this.arrivals.length = 0;
  }

  /** Throw the sentence from one listener to the next. Resolves when it lands. */
  send(from: string, to: string, ms = 900): Promise<void> {
    const a = this.line.indexOf(from);
    const b = this.line.indexOf(to);
    if (a === -1 || b === -1) return Promise.resolve();
    const fromBody = this.bodies.indexOf(this.byId.get(from)!);
    const toBody = this.bodies.indexOf(this.byId.get(to)!);
    const count = this.reduced ? 10 : this.ring.phone ? 30 : 44;
    const R = this.ring.r;
    const dur = this.reduced ? 0.25 : ms / 1000;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * R * 0.7;
      this.motes.push({
        from: fromBody, to: toBody,
        t0: this.time + (this.reduced ? 0 : (i / count) * dur * 0.45),
        dur: dur * (0.5 + Math.random() * 0.12),
        ox: Math.cos(ang) * rad, oy: Math.sin(ang) * rad,
        bend: 0.2 + Math.random() * 0.22,
        size: 0.6 + Math.random() * 0.7,
      });
    }
    this.arrivals.push({ at: this.time + dur * 0.62, id: to });
    this.wake();
    return new Promise((resolve) => window.setTimeout(resolve, dur * 1000));
  }

  /** The listener under this point of the stage, if any. */
  hit(x: number, y: number): string {
    let best = "";
    let bestD = this.ring.r * 1.5;
    for (const id of this.line) {
      const b = this.byId.get(id)!;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private wake(): void {
    if (this.running || document.hidden || !this.visible || this.w === 0) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (document.hidden || !this.visible) {
      this.running = false;
      return;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const f = dt * 60;
    const t = this.time;
    const R = this.ring.r;
    const P = this.pointer;
    const still = this.reduced;
    const k = Math.min(1, 0.11 * f);
    const damp = Math.pow(0.8, f);
    const reach = R * 2.3;

    while (this.arrivals.length > 0 && this.arrivals[0]!.at <= t) {
      const a = this.arrivals.shift()!;
      this.bump(a.id, 0.8);
      this.onArrive?.(a.id);
    }

    for (const b of this.bodies) {
      const glide = Math.min(1, 0.09 * f);
      b.cx += (b.tx - b.cx) * glide;
      b.cy += (b.ty - b.cy) * glide;
      b.on += (b.onTarget - b.on) * Math.min(1, 0.1 * f);
      if (b.on < 0.01 && b.onTarget === 0) continue;
      b.awake += (b.awakeTarget - b.awake) * Math.min(1, 0.07 * f);
      b.talk += (b.talkTarget - b.talk) * Math.min(1, 0.2 * f);
      b.think += (b.thinkTarget - b.think) * Math.min(1, 0.12 * f);
      b.shake *= Math.pow(0.9, f);
      b.nextBlink -= dt;
      if (b.nextBlink < 0) {
        b.blink = 1;
        b.nextBlink = 2 + Math.random() * 4.5;
      }
      b.blink = Math.max(0, b.blink - dt * 7);
      // Eyes follow the pointer when it is near, otherwise the middle of the ring.
      const lx = P.active ? P.x : this.ring.cx;
      const ly = P.active ? P.y : this.ring.cy;
      const ld = Math.hypot(lx - b.cx, ly - b.cy) || 1;
      b.lookX += ((lx - b.cx) / ld - b.lookX) * Math.min(1, 0.1 * f);
      b.lookY += ((ly - b.cy) / ld - b.lookY) * Math.min(1, 0.1 * f);

      const asleep = 1 - b.awake;
      const scale = (0.4 + 0.6 * b.on) * (1 + 0.07 * b.talk * Math.sin(t * 17)) * (1 + 0.55 * asleep);
      const spin = b.think * Math.sin(t * 5.2) * 0.3;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const sx = b.shake * Math.sin(t * 46) * R * 0.28;
      const near = P.active && Math.hypot(P.x - b.cx, P.y - b.cy) < reach + R * 1.4;
      const n = b.px.length;
      for (let i = 0; i < n; i++) {
        const hx = b.home[i * 2]!;
        const hy = b.home[i * 2 + 1]!;
        const ph = b.phase[i]!;
        const drift = still ? 0 : R * (0.035 + 0.3 * asleep);
        const gx = b.cx + sx + (hx * cs - hy * sn) * R * scale + Math.cos(t * (0.7 + 0.5 * asleep) + ph) * drift;
        const gy = b.cy + (hx * sn + hy * cs) * R * scale + Math.sin(t * (0.9 + 0.4 * asleep) + ph * 1.7) * drift;
        if (still) {
          b.px[i] = gx;
          b.py[i] = gy;
          continue;
        }
        let vx = b.vx[i]! + (gx - b.px[i]!) * k;
        let vy = b.vy[i]! + (gy - b.py[i]!) * k;
        if (near) {
          const dx = b.px[i]! - P.x;
          const dy = b.py[i]! - P.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < reach * reach && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = ((1 - d / reach) ** 2 * R * 0.5 * f) / d;
            vx += dx * push;
            vy += dy * push;
          }
        }
        vx *= damp;
        vy *= damp;
        b.vx[i] = vx;
        b.vy[i] = vy;
        b.px[i]! += vx * f;
        b.py[i]! += vy * f;
      }
    }
    if (this.motes.length > 0) this.motes = this.motes.filter((m) => t < m.t0 + m.dur);
  }

  private draw(): void {
    const ctx = this.ctx;
    const t = this.time;
    const R = this.ring.r;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // A few far dots, so the blue has depth.
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const sx = this.stars[i * 3]! * this.w + (this.reduced ? 0 : Math.sin(t * 0.12 + i) * 6);
      const sy = this.stars[i * 3 + 1]! * this.h + (this.reduced ? 0 : Math.cos(t * 0.1 + i * 2) * 6);
      const r = this.stars[i * 3 + 2]! * 1.5;
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, 6.2832);
    }
    ctx.fill();

    // The dotted path the sentence takes.
    const n = this.line.length;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    const beads = this.ring.phone ? 64 : 120;
    for (let i = 0; i < beads; i++) {
      const a = (Math.PI * 2 * i) / beads + (this.reduced ? 0 : t * 0.02);
      const x = this.ring.cx + this.ring.rx * Math.cos(a);
      const y = this.ring.cy + this.ring.ry * Math.sin(a);
      ctx.moveTo(x + 1.1, y);
      ctx.arc(x, y, 1.1, 0, 6.2832);
    }
    ctx.fill();

    // The bubble's tail: a few dots walking from the bubble to whoever is speaking.
    const sp = this.byId.get(this.speaker);
    if (sp && this.tail) {
      const bx = Math.max(this.tail.x, Math.min(this.tail.x + this.tail.w, sp.cx));
      const by = Math.max(this.tail.y, Math.min(this.tail.y + this.tail.h, sp.cy));
      const dx = sp.cx - bx;
      const dy = sp.cy - by;
      const len = Math.hypot(dx, dy);
      const free = len - R * 1.35;
      if (free > 10) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#f6f1e7";
        ctx.beginPath();
        const count = Math.max(2, Math.min(6, Math.floor(free / 16)));
        for (let i = 0; i < count; i++) {
          const u = (i + 0.6) / (count + 0.4);
          const x = bx + (dx / len) * free * u;
          const y = by + (dy / len) * free * u;
          const r = 5.2 * (1 - u * 0.62) * (1 + (this.reduced ? 0 : 0.12 * Math.sin(t * 6 - i)));
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, 6.2832);
        }
        ctx.fill();
      }
    }

    const dotR = R * (this.ring.phone ? 0.082 : 0.07);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const b of this.bodies) {
      if (b.on < 0.02) continue;
      const lit = b.awake;
      ctx.globalAlpha = b.on * (0.34 + 0.66 * lit);
      ctx.fillStyle = mix(SLEEP, b.rgb, lit);
      ctx.beginPath();
      const r = dotR * (0.72 + 0.28 * lit) * (b.shape === "you" ? 0.9 : 1);
      const count = b.px.length;
      for (let i = 0; i < count; i++) {
        const x = b.px[i]!;
        const y = b.py[i]!;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, 6.2832);
      }
      ctx.fill();

      if (b.shape !== "you" && lit > 0.3) {
        const face = FACES[b.shape];
        const s = R * (0.4 + 0.6 * b.on);
        const open = 1 - b.blink;
        ctx.globalAlpha = b.on * Math.min(1, (lit - 0.3) * 2.2);
        ctx.fillStyle = INK;
        const ex = b.cx + b.lookX * s * 0.07;
        const ey = b.cy + face.y * s + b.lookY * s * 0.06;
        const er = face.size * s * 1.25;
        ctx.beginPath();
        ctx.ellipse(ex - face.gap * s, ey, er, Math.max(0.6, er * open), 0, 0, 6.2832);
        ctx.ellipse(ex + face.gap * s, ey, b.id === "pirate" ? er * 1.45 : er, Math.max(0.6, (b.id === "pirate" ? er * 1.45 : er) * open), 0, 0, 6.2832);
        ctx.fill();
        if (b.talk > 0.05) {
          const m = b.talk * (0.45 + 0.55 * Math.abs(Math.sin(t * 13)));
          ctx.beginPath();
          ctx.ellipse(b.cx, b.cy + face.mouth * s, s * 0.16, s * 0.13 * m + 0.6, 0, 0, 6.2832);
          ctx.fill();
        }
        // A glint, so the eyes read as eyes.
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha *= open > 0.5 ? 0.9 : 0;
        ctx.beginPath();
        const gr = er * 0.3;
        ctx.arc(ex - face.gap * s + er * 0.3, ey - er * 0.3, gr, 0, 6.2832);
        ctx.arc(ex + face.gap * s + er * 0.3, ey - er * 0.3, gr, 0, 6.2832);
        ctx.fill();
      }

      if (b.id === this.selected) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        for (let i = 0; i < 18; i++) {
          const a = (Math.PI * 2 * i) / 18 + (this.reduced ? 0 : t * 0.9);
          const x = b.cx + Math.cos(a) * R * 1.5;
          const y = b.cy + Math.sin(a) * R * 1.5;
          ctx.moveTo(x + 1.8, y);
          ctx.arc(x, y, 1.8, 0, 6.2832);
        }
        ctx.fill();
      }

      // Names: always on a wide stage, only for the one speaking or picked on a phone.
      const named = !this.ring.phone || b.id === this.speaker || b.id === this.selected || b.id === "you";
      if (named) {
        ctx.globalAlpha = b.on * (b.id === this.speaker || b.id === this.selected ? 1 : 0.42 + 0.3 * lit);
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${this.ring.phone ? 11 : 12.5}px "Schibsted Grotesk Variable", system-ui, sans-serif`;
        ctx.fillText(b.name, b.cx, b.cy + R * 1.22);
      }
    }

    // The sentence in flight.
    if (this.motes.length > 0) {
      for (const m of this.motes) {
        const u = (t - m.t0) / m.dur;
        if (u <= 0) continue;
        const a = this.bodies[m.from]!;
        const b = this.bodies[m.to]!;
        const mx = (a.cx + b.cx) / 2;
        const my = (a.cy + b.cy) / 2;
        const qx = mx + (this.ring.cx - mx) * m.bend;
        const qy = my + (this.ring.cy - my) * m.bend;
        for (let g = 0; g < 3; g++) {
          const uu = ease(Math.max(0, Math.min(1, u - g * 0.05)));
          const iu = 1 - uu;
          const x = iu * iu * (a.cx + m.ox) + 2 * iu * uu * (qx + m.ox * 1.4) + uu * uu * (b.cx + m.ox * 0.5);
          const y = iu * iu * (a.cy + m.oy) + 2 * iu * uu * (qy + m.oy * 1.4) + uu * uu * (b.cy + m.oy * 0.5);
          ctx.globalAlpha = (g === 0 ? 1 : g === 1 ? 0.45 : 0.2) * Math.min(1, u * 8);
          ctx.fillStyle = mix(a.rgb, b.rgb, uu);
          const r = dotR * 1.25 * m.size * (1 - g * 0.18);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 6.2832);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    void n;
  }
}
