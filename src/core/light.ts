/**
 * The light version: every listener's habit written by hand, as plain rules.
 * It runs when the model is not there yet, cannot run on this device, or made
 * something unusable. No model, no download, instant.
 */
import { isClean, MAX_WORDS } from "./clean";

export type Rng = () => number;

/** Small seeded generator, so a daily chain in light mode is the same for everyone. */
export function rngFrom(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length)]!;

const DET = new Set("the a an my your our his her their this that some every".split(" "));
const ADJ = new Set(
  "warm big little small old new red blue green yellow good bad happy sad hot cold long short tall tiny huge best nice great funny quiet loud soft fast slow first last whole next brave shiny sleepy famous golden royal grand magnificent legendary".split(
    " ",
  ),
);
const NOT_NOUN = new Set("million billion zillion thousand hundred lot few couple bit times is are was will not of".split(" "));
const KEEP_CASE = new Set(["I", "I'm", "I'll", "I've", "I'd"]);

const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
const PREFIX =
  /^(oh no|i heard|apparently|they say|don't tell anyone, but|arr|ahoy|yo ho|breaking news|this just in|affirmative|naturally|i am worried that|it is not true that)[,.:]?\s+/i;
const SUFFIX = /(,? matey|\.? beep|, and it was my idea|, and it might all go wrong)$/i;

/**
 * The part of a sentence a listener actually catches: without the last
 * speaker's flourishes, and without the tail of anything long. Listeners
 * half-listen, which is the game.
 */
const body = (s: string) => {
  let b = s.trim().replace(/[.!?]+$/, "");
  for (let i = 0; i < 3; i++) b = b.replace(PREFIX, "").replace(SUFFIX, "").replace(/[.!?]+$/, "");
  const ws = b.split(" ");
  if (ws.length > 11) {
    const cut = b.lastIndexOf(",", b.length - 1);
    const head = cut > 0 ? b.slice(0, b.indexOf(",")) : "";
    b = head.split(" ").length >= 4 ? head : ws.slice(0, 10).join(" ").replace(/[,;:]+$/, "");
  }
  return upperFirst(b);
};
function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const lowerFirst = (s: string) => {
  const first = s.split(" ")[0] ?? "";
  if (KEEP_CASE.has(first) || /^[A-Z][a-z]+day$/.test(first)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
};
const end = (s: string, mark = ".") => (/[.!?]$/.test(s) ? s : s + mark);

/** Index of each word that looks like the noun of "the big dog": the word after a determiner and its adjectives. */
function nounSpots(ws: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ws.length - 1; i++) {
    if (!DET.has(bare(ws[i]!))) continue;
    let j = i + 1;
    while (j < ws.length - 1 && ADJ.has(bare(ws[j]!))) j++;
    if (!DET.has(bare(ws[j]!)) && !NOT_NOUN.has(bare(ws[j]!))) out.push(j);
  }
  return out;
}

/** Replace the word at `i`, keeping any punctuation stuck to it. */
function swapWord(ws: string[], i: number, to: string): void {
  const m = /^([^A-Za-z0-9']*)([A-Za-z0-9']+)(.*)$/.exec(ws[i]!);
  ws[i] = m ? `${m[1]}${to}${m[3]}` : to;
}

const plural = (w: string) => (/(s|x|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

const NUMBERS: Record<string, string> = {
  one: "one hundred", two: "two thousand", three: "three thousand", four: "four hundred", five: "five thousand",
  six: "six hundred", seven: "seven thousand", eight: "eight hundred", nine: "nine thousand", ten: "ten thousand",
  twenty: "twenty thousand", hundred: "million", thousand: "million", million: "billion", billion: "zillion",
  few: "a million", some: "nine hundred", many: "a zillion", couple: "thousand",
};

const OPPOSITE: [string, string][] = [
  ["hot", "cold"], ["warm", "freezing"], ["big", "tiny"], ["little", "enormous"], ["small", "gigantic"], ["up", "down"],
  ["open", "close"], ["opened", "closed"], ["love", "avoid"], ["loves", "avoids"], ["like", "dislike"], ["likes", "dislikes"],
  ["morning", "midnight"], ["sunrise", "sunset"], ["tomorrow", "yesterday"], ["today", "never"], ["always", "never"],
  ["found", "lost"], ["fine", "terrible"], ["happy", "grumpy"], ["fast", "slow"], ["on", "under"], ["before", "after"],
  ["with", "without"], ["dinner", "breakfast"], ["lunch", "midnight snack"], ["early", "late"], ["first", "last"],
  ["new", "ancient"], ["old", "brand new"], ["quiet", "noisy"], ["inside", "outside"], ["in", "out of"], ["day", "night"],
  ["launch", "land"], ["leaves", "arrives"], ["start", "stop"], ["starts", "stops"], ["win", "lose"], ["won", "lost"],
  ["friday", "Monday"], ["saturday", "Tuesday"], ["sunday", "Wednesday"], ["monday", "Friday"], ["yes", "no"],
  ["good", "dreadful"], ["best", "worst"], ["everyone", "nobody"], ["all", "none of"], ["remember", "forget"],
  ["is", "is not"], ["are", "are not"], ["will", "will not"], ["was", "was not"], ["can", "cannot"],
];

const PIRATE: [RegExp, string][] = [
  [/\bmy\b/gi, "me"], [/\byou\b/gi, "ye"], [/\byour\b/gi, "yer"], [/\b(is|are|am)\b/gi, "be"], [/\bfriends?\b/gi, "mateys"],
  [/\b(bus|car|train|bike|rocket|plane|taxi)\b/gi, "ship"], [/\b(house|home|school|office)\b/gi, "island"],
  [/\b(money|coins?)\b/gi, "treasure"], [/\byes\b/gi, "aye"], [/\bthe (meeting|party|class)\b/gi, "the voyage"],
  [/ing\b/g, "in'"],
];

const ROBOT: [RegExp, string][] = [
  [/\bI am\b/g, "this unit is"], [/\bI\b/g, "this unit"], [/\bmy\b/gi, "this unit's"], [/\bwe are\b/gi, "all units are"],
  [/\bwe\b/gi, "all units"], [/\bcats?\b/gi, "feline unit"], [/\bdogs?\b/gi, "canine unit"], [/\b(dinner|lunch|breakfast)\b/gi, "refuelling"],
  [/\b(ate|eats|eat)\b/gi, "consumed"], [/\b(happy|fine|good)\b/gi, "operating normally"], [/\btomorrow\b/gi, "in 24 hours"],
  [/\b(house|home)\b/gi, "base"], [/\bfriends?\b/gi, "fellow units"], [/\bplease\b/gi, "request:"], [/\b(grandma|grandpa|mum|mom|dad)\b/gi, "senior human"],
  [/\b(brother|sister)\b/gi, "sibling unit"], [/\bsunrise\b/gi, "06:00 hours"],
];

const GRAND = ["magnificent", "legendary", "world-famous", "golden", "award-winning", "royal", "dazzling"];
const FOODS = ["pizza", "noodles", "pancake", "sandwich", "dumpling", "mango", "cheese"];
const RHYMES: [RegExp, string][] = [
  [/(at|ats)$/, "wearing a hat"], [/(ine|ign)$/, "in the bright sunshine"], [/(ay|ey|eigh)$/, "on a bright and breezy day"],
  [/(ight|ite)$/, "in the soft moonlight"], [/(ow|oe|o)$/, "where the gentle rivers flow"], [/(ee|ea|e|y)$/, "by the deep blue sea"],
  [/(ill|il)$/, "at the top of the hill"], [/(ing)$/, "while the bluebirds sing"], [/(ar|are)$/, "underneath a shining star"],
  [/(oon|une)$/, "by the light of the moon"], [/(ise|ize|ies)$/, "under wide and open skies"], [/(own|ound)$/, "all around the sleepy town"],
  [/(air|are|ear)$/, "with the wind in our hair"], [/(ed|ead)$/, "or so the poets said"],
];
const TAILS = ["as soft as morning dew", "beneath a sky of blue", "and every word is true", "with a heart both brave and bright", "like a feather in the light"];

type Habit = (heard: string, rng: Rng) => string;

const HABITS: Record<string, Habit> = {
  worrier(heard, rng) {
    const b = body(heard);
    const options = [
      `Oh no, ${lowerFirst(b)}, and it might all go wrong.`,
      `${b}, but what if it rains?`,
      `I am worried that ${lowerFirst(b)}.`,
      `${b}, and nobody packed a spare.`,
    ].filter((o) => !/^oh no/i.test(b) || !/^oh no/i.test(o));
    return pick(options, rng);
  },

  showoff(heard, rng) {
    const ws = body(heard).split(" ");
    const spots = nounSpots(ws).slice(0, 2);
    if (spots.length === 0) return `Naturally, ${lowerFirst(body(heard))}, and it was my idea.`;
    const used = new Set<string>();
    for (const at of spots.reverse()) {
      let g = pick(GRAND, rng);
      while (used.has(g)) g = pick(GRAND, rng);
      used.add(g);
      const before = bare(ws[at - 1] ?? "");
      if (before === "a" || before === "an") ws[at - 1] = /^[aeiou]/.test(g) ? "an" : "a";
      ws.splice(at, 0, g);
    }
    return end(ws.join(" "));
  },

  shortener(heard) {
    const drop = new Set([...DET, ..."and but so is are was were be am will would to of for at on in with while very really just please oh no that it what if i we you".split(" ")]);
    const ws = body(heard).split(" ").filter((w) => !drop.has(bare(w)) && !ADJ.has(bare(w)));
    const kept = (ws.length >= 2 ? ws : body(heard).split(" ")).slice(0, 4).map((w) => w.replace(/[,;:]/g, ""));
    return end(upperFirst(kept.join(" ")));
  },

  exaggerator(heard, rng) {
    const ws = body(heard).split(" ");
    let hit = false;
    for (let i = 0; i < ws.length; i++) {
      const w = bare(ws[i]!);
      if (/^\d+$/.test(w)) {
        swapWord(ws, i, String(Number(w) * 1000));
        hit = true;
      } else if (NUMBERS[w] && !(w === "one" && bare(ws[i + 1] ?? "") === "of")) {
        swapWord(ws, i, NUMBERS[w]!);
        hit = true;
      }
    }
    if (!hit) {
      const spots = nounSpots(ws);
      const at = spots[0];
      if (at !== undefined) {
        const big = pick(["nine hundred", "a million", "seven thousand"], rng);
        // "the warm windowsill" becomes "nine hundred warm windowsills".
        let d = at - 1;
        while (d > 0 && !DET.has(bare(ws[d]!))) d--;
        ws[d] = d === 0 ? upperFirst(big) : big;
        swapWord(ws, at, plural(bare(ws[at]!)));
        hit = true;
      }
    }
    return hit ? end(ws.join(" ")) : `${body(heard)}, a million times over.`;
  },

  poet(heard, rng) {
    const b = body(heard);
    const last = bare(b.split(" ").at(-1) ?? "");
    const rhyme = RHYMES.find(([re]) => re.test(last));
    return `${b}, ${rhyme ? rhyme[1] : pick(TAILS, rng)}.`;
  },

  cat(heard) {
    const ws = body(heard).split(" ");
    const spots = nounSpots(ws).filter((i) => !/^(cat|kitten)s?$/.test(bare(ws[i]!)));
    const has = /\b(cat|kitten)s?\b/i.test(heard);
    if (spots.length === 0) return `${body(heard)}, and the cat saw everything.`;
    swapWord(ws, spots[0]!, has ? "kitten" : "cat");
    const d = spots[0]! - 1;
    if (bare(ws[d] ?? "") === "an") ws[d] = ws[d]!.replace(/n$/, "");
    return end(ws.join(" "));
  },

  gossip(heard, rng) {
    const b = lowerFirst(body(heard));
    const open = pick(["I heard", "Apparently", "They say", "Don't tell anyone, but"], rng);
    const secret = pick(
      ["and a parrot told me", "and there was a tiny hat involved", "and nobody is supposed to know", "and the neighbours already know", "and it happened twice"],
      rng,
    );
    return `${open} ${b}, ${secret}.`;
  },

  pirate(heard, rng) {
    let b = lowerFirst(body(heard)).replace(/^(arr|ahoy|yo ho),?\s*/i, "");
    for (const [re, to] of PIRATE) b = b.replace(re, to);
    return `${pick(["Arr", "Ahoy", "Yo ho"], rng)}, ${b}, matey.`;
  },

  contrarian(heard) {
    const ws = body(heard).split(" ");
    for (const [from, to] of OPPOSITE) {
      const i = ws.findIndex((w) => bare(w) === from);
      if (i === -1) continue;
      if ((from === "is" || from === "are" || from === "will" || from === "was" || from === "can") && bare(ws[i + 1] ?? "") === "not") continue;
      swapWord(ws, i, i === 0 ? upperFirst(to) : to);
      return end(ws.join(" "));
    }
    return `It is not true that ${lowerFirst(body(heard))}.`;
  },

  hungry(heard, rng) {
    const ws = body(heard).split(" ");
    const spots = nounSpots(ws).filter((i) => !FOODS.includes(bare(ws[i]!)));
    if (spots.length === 0) return `${body(heard)}, with extra cheese.`;
    const at = spots.at(-1)!;
    const food = pick(FOODS, rng);
    swapWord(ws, at, food);
    const d = at - 1;
    if (bare(ws[d] ?? "") === "an") ws[d] = ws[d]!.replace(/n$/, "");
    return end(ws.join(" "));
  },

  announcer(heard, rng) {
    const b = lowerFirst(body(heard)).replace(/^(breaking news|this just in)\s*:\s*/i, "");
    const tail = pick(["", ", experts amazed", ", town cannot believe it", ", more at ten"], rng);
    return `${pick(["Breaking news", "This just in"], rng)}: ${b}${tail}!`;
  },

  robot(heard) {
    let b = body(heard).replace(/^(affirmative|statement received)[.:]?\s*/i, "");
    for (const [re, to] of ROBOT) b = b.replace(re, to);
    return `Affirmative. ${upperFirst(b)}. Beep.`;
  },
};

function trim(s: string): string {
  const ws = s.split(" ");
  if (ws.length <= MAX_WORDS) return s;
  return ws.slice(0, MAX_WORDS).join(" ").replace(/[,;:]+$/, "") + ".";
}

/** One listener's hand-built rewrite of what it heard. */
export function lightRewrite(listenerId: string, heard: string, rng: Rng): string {
  const habit = HABITS[listenerId];
  if (!habit) return heard;
  const out = trim(habit(heard, rng).replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/,\./g, "."));
  return isClean(out) ? out : heard;
}

/**
 * Careful mode's second try in the light version: say it back exactly, with a
 * small chance of one slip, because a second try is better, not perfect.
 */
export function lightRepeat(heard: string, rng: Rng): string {
  if (rng() > 0.2) return heard;
  const ws = heard.split(" ");
  const i = ws.findIndex((w) => ADJ.has(bare(w)));
  if (i !== -1 && ws.length > 3) {
    ws.splice(i, 1);
    return upperFirst(ws.join(" "));
  }
  return heard;
}
