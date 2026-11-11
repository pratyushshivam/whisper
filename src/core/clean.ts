/**
 * Everything a sentence goes through before it is shown: tidying what the
 * visitor typed, tidying what the model wrote, and a family-friendly filter
 * that applies to both.
 */

export const MAX_INPUT = 120;
export const MAX_WORDS = 24;

// Kept deliberately short and blunt: stems that have no place on a page a
// six-year-old might be reading. Matching is on whole words or word starts.
const BLOCKED = [
  "fuck", "shit", "bitch", "bastard", "asshole", "arse", "dick", "cock", "pussy", "cunt", "slut", "whore",
  "piss", "crap", "damn", "wank", "twat", "prick", "nigg", "fag", "retard", "rape", "rapist", "porn", "sex",
  "nude", "naked", "boob", "penis", "vagina", "kill", "murder", "suicide", "stab", "shoot", "gun", "bomb",
  "terror", "nazi", "hitler", "drug", "cocaine", "heroin", "meth", "weed", "drunk", "beer", "vodka", "whiskey",
  "wine", "cigarette", "dead", "die", "dies", "died", "death", "corpse", "blood", "bloody", "hell", "hate",
  "stupid", "idiot", "moron", "dumb", "ugly", "fat", "bum", "butt", "ass", "poop", "fart", "zombie", "flesh", "poison", "weapon", "knife", "grave", "coffin", "vomit", "puke", "demon", "devil", "satan", "doom", "explo", "destroy", "curse",
];
const EXACT = new Set(["bum", "butt", "ass", "die", "dies", "died", "fat", "hell", "gun", "sex", "fag", "weed", "wine", "beer", "meth", "dead", "hate", "arse", "stab", "dumb", "ugly", "kill", "drug", "cock", "dick", "crap", "damn", "piss"]);

export function isClean(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
  for (const w of words) {
    for (const b of BLOCKED) {
      if (EXACT.has(b)) {
        if (w === b || w === `${b}s` || w === `${b}ed` || w === `${b}ing`) return false;
      } else if (w.startsWith(b)) {
        return false;
      }
    }
  }
  return true;
}

/** Tidy what the visitor typed. Returns "" when there is nothing usable. */
export function cleanInput(raw: string): string {
  let s = raw.replace(/[\u0000-\u001f<>{}[\]\\|`^~_*#@=+]/g, " ").replace(/https?:\S+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > MAX_INPUT) s = s.slice(0, MAX_INPUT).replace(/\s+\S*$/, "");
  if (!/[a-zA-Z]{2}/.test(s)) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

/**
 * Tidy what the model wrote. Returns "" when the output is not a usable
 * sentence, and the caller falls back to the hand-built rewrite.
 */
export function cleanOutput(raw: string, heard: string): string {
  let s = raw.split(/\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  s = s.replace(/^(assistant|user|system|answer|output|rewrite|sentence)\s*:\s*/i, "");
  s = s.replace(/[“”"*_`#<>|\\]/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/^['‘]+|['’]+$/g, "");
  // Keep at most two sentences.
  const parts = s.match(/[^.!?]+[.!?]+/g);
  if (parts && parts.length > 2) s = parts.slice(0, 2).join("").trim();
  // An unfinished tail after the last full sentence is dropped.
  if (parts && parts.length >= 1 && !/[.!?]$/.test(s)) s = parts.slice(0, 2).join("").trim();
  let words = s.split(" ");
  if (words.length > MAX_WORDS) {
    // Too long: stop at the last pause that still leaves a real sentence, else at the limit.
    words = words.slice(0, MAX_WORDS);
    let cut = -1;
    for (let i = words.length - 2; i >= 6; i--) {
      if (/[,;:]$/.test(words[i]!)) {
        cut = i + 1;
        break;
      }
    }
    if (cut > 0) words = words.slice(0, cut);
    s = words.join(" ").replace(/[,;:\-]+$/, "") + ".";
  }
  if (!/[.!?]$/.test(s)) s += ".";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 3 || words.length < 2) return "";
  if (/[^\x20-\x7e -ɏ‘’—–]/.test(s)) return "";
  if (hasLoop(s)) return "";
  if (/\b(sentence|rewrite|repeat|as an ai|i cannot|i can't|sorry)\b/i.test(s) && !/\b(sentence|repeat|sorry)\b/i.test(heard)) return "";
  if (!isClean(s)) return "";
  return s;
}

/** True when the text keeps saying the same few words. */
function hasLoop(s: string): boolean {
  const w = s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (w.length < 8) return false;
  const seen = new Map<string, number>();
  for (let i = 0; i + 1 < w.length; i++) {
    const k = `${w[i]} ${w[i + 1]}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const n of seen.values()) if (n >= 3) return true;
  return new Set(w).size < w.length * 0.5;
}
