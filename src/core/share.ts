/**
 * A finished chain packed into a link. Generation is not repeatable, so the
 * link carries the sentences themselves, not a seed.
 */
import { isClean } from "./clean";
import { drift } from "./drift";
import type { Step } from "./chain";
import { BY_ID, BY_KEY } from "./listeners";

export interface Saved {
  sentence: string;
  careful: boolean;
  steps: Step[];
}

interface Wire {
  v: 1;
  s: string;
  l: string;
  c: 0 | 1;
  /** What each listener passed on. */
  t: string[];
  /** Careful mode: the read-back where the check failed, "" where it passed. */
  r?: string[];
  /** "m" or "l" per step: who wrote it. */
  b: string;
}

const toB64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function encodeChain(saved: Saved): string {
  const wire: Wire = {
    v: 1,
    s: saved.sentence,
    l: saved.steps.map((s) => BY_ID.get(s.listener)?.key ?? "").join(""),
    c: saved.careful ? 1 : 0,
    t: saved.steps.map((s) => s.said),
    b: saved.steps.map((s) => (s.by === "model" ? "m" : "l")).join(""),
  };
  if (saved.careful) wire.r = saved.steps.map((s) => (s.check && !s.check.passed ? s.check.readBack : ""));
  return toB64(JSON.stringify(wire));
}

/** Read a chain back out of a link. Anything odd, unclean or oversized gives null. */
export function decodeChain(code: string): Saved | null {
  try {
    if (code.length > 6000) return null;
    const wire = JSON.parse(fromB64(code)) as Wire;
    if (wire.v !== 1 || typeof wire.s !== "string" || !Array.isArray(wire.t)) return null;
    const keys = [...wire.l];
    if (keys.length < 1 || keys.length > 12 || keys.length !== wire.t.length) return null;
    // Text from a link is shown as text only, but it is still held to the page's rules:
    // plain characters, a sane length, and the family filter.
    const tidy = (t: unknown): string | null => {
      if (typeof t !== "string" || t.length > 400) return null;
      const c = t.replace(/[\u0000-\u001f<>{}[\]\|`^~_*#@=+]/g, " ").replace(/\s+/g, " ").trim();
      return /[a-zA-Z]{2}/.test(c) && isClean(c) ? c : null;
    };
    const sentence = tidy(wire.s);
    if (!sentence) return null;
    const steps: Step[] = [];
    let heard = sentence;
    for (let i = 0; i < keys.length; i++) {
      const l = BY_KEY.get(keys[i]!);
      const said = tidy(wire.t[i]);
      if (!l || !said) return null;
      const step: Step = { listener: l.id, heard, said, by: wire.b?.[i] === "m" ? "model" : "light", drift: drift(sentence, said) };
      if (wire.c) {
        const back = wire.r?.[i];
        const readBack = back ? tidy(back) : null;
        step.check = readBack ? { readBack, passed: false } : { readBack: said, passed: true };
      }
      steps.push(step);
      heard = said;
    }
    return { sentence, careful: wire.c === 1, steps };
  } catch {
    return null;
  }
}
