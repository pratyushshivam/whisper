/**
 * Silhouettes. Each is a yes/no test over a unit square (x right, y down,
 * roughly -1 to 1), filled with a honeycomb of dots.
 */
import type { ShapeId } from "../core/listeners";

type Test = (x: number, y: number) => boolean;

const disc = (x: number, y: number, cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
/** A spike standing on `base`, pointing up to `tip`. */
const spike = (x: number, y: number, cx: number, base: number, tip: number, half: number) =>
  y < base && y > tip && Math.abs(x - cx) < (half * (y - tip)) / (base - tip);

const TESTS: Record<ShapeId | "you", Test> = {
  drop: (x, y) => disc(x, y, 0, 0.28, 0.72) || spike(x, y, 0, 0.1, -1.05, 0.62),
  crown: (x, y) =>
    disc(x, y, 0, 0.28, 0.72) || spike(x, y, -0.48, -0.1, -0.95, 0.24) || spike(x, y, 0, -0.2, -1.08, 0.26) || spike(x, y, 0.48, -0.1, -0.95, 0.24),
  pebble: (x, y) => (x / 1.02) ** 2 + ((y - 0.1) / 0.62) ** 2 < 1,
  burst: (x, y) => Math.hypot(x, y) < 0.74 + 0.26 * Math.cos(9 * Math.atan2(y, x)),
  moon: (x, y) => disc(x, y, -0.05, 0, 0.95) && !disc(x, y, 0.62, -0.42, 0.62),
  cat: (x, y) => disc(x, y, 0, 0.22, 0.76) || spike(x, y, -0.5, 0, -1.0, 0.3) || spike(x, y, 0.5, 0, -1.0, 0.3),
  cloud: (x, y) => disc(x, y, -0.52, 0.22, 0.48) || disc(x, y, 0.52, 0.22, 0.48) || disc(x, y, -0.05, -0.2, 0.6) || disc(x, y, 0.1, 0.3, 0.52),
  skull: (x, y) => disc(x, y, 0, 0.3, 0.68) || (y > -0.5 && y < -0.24 && Math.abs(x) < 1.02) || (y > -1.0 && y <= -0.5 && Math.abs(x) < 0.56),
  diamond: (x, y) => Math.abs(x) * 0.95 + Math.abs(y) < 1.02,
  donut: (x, y) => disc(x, y, 0, 0, 0.93) && !disc(x, y, 0.8, -0.72, 0.42),
  bell: (x, y) =>
    (y > -0.88 && y < 0.5 && Math.abs(x) < 0.34 + 0.44 * ((y + 0.88) / 1.38) ** 1.6) || (y >= 0.5 && y < 0.74 && Math.abs(x) < 1.0) || disc(x, y, 0, 0.94, 0.15),
  box: (x, y) => (Math.abs(x) < 0.8 && Math.abs(y - 0.18) < 0.68) || (Math.abs(x) < 0.07 && y > -0.92 && y < -0.5) || disc(x, y, 0, -0.96, 0.15),
  you: (x, y) => {
    const r = Math.hypot(x, y);
    return r > 0.6 && r < 0.96;
  },
};

/** Where the face sits on each silhouette: eye height, half the gap between the eyes, eye size. */
export const FACES: Record<ShapeId, { y: number; gap: number; size: number; mouth: number }> = {
  drop: { y: 0.2, gap: 0.26, size: 0.115, mouth: 0.58 },
  crown: { y: 0.2, gap: 0.27, size: 0.115, mouth: 0.6 },
  pebble: { y: 0.0, gap: 0.3, size: 0.105, mouth: 0.36 },
  burst: { y: -0.08, gap: 0.24, size: 0.11, mouth: 0.3 },
  moon: { y: 0.12, gap: 0.24, size: 0.11, mouth: 0.52 },
  cat: { y: 0.14, gap: 0.28, size: 0.12, mouth: 0.55 },
  cloud: { y: 0.02, gap: 0.27, size: 0.115, mouth: 0.42 },
  skull: { y: 0.2, gap: 0.26, size: 0.115, mouth: 0.6 },
  diamond: { y: -0.08, gap: 0.24, size: 0.105, mouth: 0.3 },
  donut: { y: -0.02, gap: 0.27, size: 0.115, mouth: 0.42 },
  bell: { y: 0.02, gap: 0.2, size: 0.1, mouth: 0.36 },
  box: { y: 0.06, gap: 0.3, size: 0.12, mouth: 0.5 },
};

/**
 * The dots of one silhouette, as x,y pairs in unit coordinates.
 * `step` is the distance between neighbours: smaller means more dots.
 */
export function dotsFor(shape: ShapeId | "you", step: number): Float32Array {
  const test = TESTS[shape];
  const out: number[] = [];
  const rowH = step * 0.866;
  let row = 0;
  for (let y = -1.15; y <= 1.15; y += rowH, row++) {
    const shift = row % 2 === 0 ? 0 : step / 2;
    for (let x = -1.15 + shift; x <= 1.15; x += step) {
      if (test(x, y)) out.push(x, y);
    }
  }
  return new Float32Array(out);
}
