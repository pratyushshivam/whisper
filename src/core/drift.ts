/**
 * How far a sentence has moved from another one. This is a word measure, not
 * a meaning measure: it counts which of the original's content words survive.
 */

const STOP = new Set(
  "a an the and or but so of to in on at for with by from as is are was were be been am it its this that these those i you he she we they me my your our their his her him them us do does did will would can could should may might have has had not no yes oh just very too also then than there here what if while when".split(
    " ",
  ),
);

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9'\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
}

/** A crude stem: enough to see that "cats" and "cat" are the same word. */
export function stem(w: string): string {
  let s = w.replace(/'s$|'$/g, "").replace(/'/g, "");
  if (s.length > 4 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 3 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 2 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

function content(text: string): Set<string> {
  const all = words(text);
  const kept = all.filter((w) => !STOP.has(w)).map(stem);
  return new Set(kept.length > 0 ? kept : all.map(stem));
}

/** 1 when every content word of `a` survives in `b` and nothing was added, 0 when none do. */
export function similarity(a: string, b: string): number {
  const A = content(a);
  const B = content(b);
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  const recall = both / A.size;
  const precision = both / B.size;
  return 0.7 * recall + 0.3 * precision;
}

/** 0 to 1: how far `now` has drifted from `original`. */
export function drift(original: string, now: string): number {
  return Math.max(0, Math.min(1, 1 - similarity(original, now)));
}

export interface Piece {
  text: string;
  /** True when this word was not in what the listener heard. */
  changed: boolean;
}

/** The words of `said`, each marked as kept or new compared with `heard`. */
export function diffWords(heard: string, said: string): Piece[] {
  const a = heard.split(/\s+/).filter(Boolean);
  const b = said.split(/\s+/).filter(Boolean);
  const key = (w: string) => stem(w.toLowerCase().replace(/[^a-z0-9']/g, ""));
  const ka = a.map(key);
  const kb = b.map(key);
  const n = ka.length;
  const m = kb.length;
  // Longest common subsequence, by table.
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i]![j] = ka[i] === kb[j] && ka[i] !== "" ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
    }
  }
  const out: Piece[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && ka[i] === kb[j] && ka[i] !== "") {
      out.push({ text: b[j]!, changed: false });
      i++;
      j++;
    } else if (i < n && t[i + 1]![j]! >= t[i]![j + 1]!) {
      i++;
    } else {
      out.push({ text: b[j]!, changed: true });
      j++;
    }
  }
  return out;
}

/** True when two sentences are the same apart from case and punctuation. */
export function sameWords(a: string, b: string): boolean {
  return words(a).join(" ") === words(b).join(" ");
}
