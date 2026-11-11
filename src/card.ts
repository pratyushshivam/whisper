/** The share card: first sentence, last sentence and the line that did it, drawn on a canvas. */
import type { Saved } from "./core/share";
import { BY_ID } from "./core/listeners";
import { dotsFor } from "./scene/shapes";

const W = 1080;
const H = 1350;
const DISPLAY = '"Anybody Variable", "Schibsted Grotesk Variable", system-ui, sans-serif';
const TEXT = '"Schibsted Grotesk Variable", system-ui, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Set `text` in the largest size from `sizes` that fits in `maxLines`. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, sizes: number[], maxWidth: number, maxLines: number) {
  for (const px of sizes) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines || px === sizes.at(-1)) return { px, lines: lines.slice(0, maxLines + 1) };
  }
  return { px: sizes.at(-1)!, lines: [text] };
}

export async function drawCard(saved: Saved): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([document.fonts.load(`800 80px ${DISPLAY}`), document.fonts.load(`500 40px ${TEXT}`)]);
  } catch {
    /* draw with whatever is there */
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.4, H * 0.9);
  bg.addColorStop(0, "#3344ff");
  bg.addColorStop(1, "#1a22c8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // A honeycomb of faint dots behind everything.
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let y = 20, row = 0; y < H; y += 30, row++) {
    for (let x = row % 2 ? 35 : 20; x < W; x += 30) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, 6.2832);
      ctx.fill();
    }
  }

  const pad = 84;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 54px ${DISPLAY}`;
  ctx.fillText("whisper", pad, 70);
  ctx.font = `500 26px ${TEXT}`;
  ctx.globalAlpha = 0.75;
  ctx.textAlign = "right";
  ctx.fillText(saved.careful ? "careful mode" : "the telephone game, played by AIs", W - pad, 86);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;

  // First sentence.
  let y = 196;
  ctx.font = `600 28px ${TEXT}`;
  ctx.globalAlpha = 0.75;
  ctx.fillText("IT STARTED AS", pad, y);
  ctx.globalAlpha = 1;
  y += 50;
  const first = fit(ctx, saved.sentence, (px) => `500 ${px}px ${TEXT}`, [54, 46, 40, 34], W - pad * 2, 3);
  for (const line of first.lines) {
    ctx.fillText(line, pad, y);
    y += first.px * 1.22;
  }

  // The line of listeners.
  y += 44;
  const n = saved.steps.length;
  const gap = Math.min(92, (W - pad * 2) / n);
  const r = gap * 0.36;
  saved.steps.forEach((step, i) => {
    const l = BY_ID.get(step.listener);
    if (!l) return;
    const cx = pad + gap * i + gap / 2;
    const cy = y + r;
    const dots = dotsFor(l.shape, 0.27);
    ctx.fillStyle = l.colour;
    for (let k = 0; k < dots.length; k += 2) {
      ctx.beginPath();
      ctx.arc(cx + dots[k]! * r, cy + dots[k + 1]! * r, r * 0.1, 0, 6.2832);
      ctx.fill();
    }
  });
  y += r * 2 + 30;
  ctx.font = `500 25px ${TEXT}`;
  ctx.globalAlpha = 0.8;
  const names = saved.steps.map((s) => BY_ID.get(s.listener)?.name.replace(/^The /, "") ?? "").join("  →  ");
  for (const line of wrap(ctx, names, W - pad * 2).slice(0, 3)) {
    ctx.fillText(line, pad, y);
    y += 36;
  }
  ctx.globalAlpha = 1;

  // Last sentence, on a cream bubble that takes the rest of the card.
  const last = saved.steps.at(-1)!;
  const lastColour = BY_ID.get(last.listener)?.colour ?? "#ffd23f";
  const top = y + 36;
  const bottom = H - 150;
  ctx.fillStyle = "#f6f1e7";
  ctx.beginPath();
  ctx.roundRect(pad - 24, top, W - (pad - 24) * 2, bottom - top, 44);
  ctx.fill();
  ctx.fillStyle = lastColour;
  ctx.beginPath();
  ctx.roundRect(pad - 24, top, 18, bottom - top, [44, 0, 0, 44]);
  ctx.fill();
  ctx.fillStyle = "#0a0e3d";
  ctx.font = `600 28px ${TEXT}`;
  ctx.globalAlpha = 0.7;
  ctx.fillText(`AND CAME OUT, ${n} LISTENER${n === 1 ? "" : "S"} LATER, AS`, pad + 28, top + 44);
  ctx.globalAlpha = 1;
  const room = bottom - top - 130;
  const maxLines = (px: number) => Math.max(1, Math.floor(room / (px * 1.16)));
  let chosen = { px: 44, lines: [last.said] };
  for (const px of [92, 78, 66, 56, 48, 42]) {
    ctx.font = `800 ${px}px ${DISPLAY}`;
    const lines = wrap(ctx, last.said, W - pad * 2 - 60);
    chosen = { px, lines };
    if (lines.length <= maxLines(px)) break;
  }
  ctx.font = `800 ${chosen.px}px ${DISPLAY}`;
  let ty = top + 104;
  for (const line of chosen.lines.slice(0, maxLines(chosen.px))) {
    ctx.fillText(line, pad + 28, ty);
    ty += chosen.px * 1.16;
  }

  // Foot.
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 40px ${DISPLAY}`;
  ctx.fillText(`${Math.round(last.drift * 100)}% drift`, pad, H - 108);
  ctx.font = `500 26px ${TEXT}`;
  ctx.globalAlpha = 0.8;
  ctx.textAlign = "right";
  ctx.fillText("pratyushshivam.github.io/whisper", W - pad, H - 98);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
  return canvas;
}

export const cardBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
