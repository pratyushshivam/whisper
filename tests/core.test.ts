import { describe, expect, it } from "vitest";
import { runChain, type Step } from "../src/core/chain";
import { cleanInput, cleanOutput, isClean } from "../src/core/clean";
import { dailySentence, dayNumber, SUGGESTED } from "../src/core/daily";
import { diffWords, drift, sameWords, similarity } from "../src/core/drift";
import { lightRewrite, rngFrom } from "../src/core/light";
import { DEFAULT_LINE, LISTENERS, promptFor } from "../src/core/listeners";
import { decodeChain, encodeChain } from "../src/core/share";

async function collect(sentence: string, careful: boolean, line = DEFAULT_LINE): Promise<Step[]> {
  const out: Step[] = [];
  for await (const s of runChain({ sentence, line, careful, ask: null, rng: rngFrom(sentence) })) out.push(s);
  return out;
}

describe("the cast", () => {
  it("has twelve listeners with unique ids, link keys and colours", () => {
    expect(LISTENERS).toHaveLength(12);
    for (const field of ["id", "key", "colour", "shape"] as const) {
      expect(new Set(LISTENERS.map((l) => l[field])).size).toBe(12);
    }
  });
  it("puts ten of them on the default line", () => {
    expect(DEFAULT_LINE).toHaveLength(10);
    for (const id of DEFAULT_LINE) expect(LISTENERS.some((l) => l.id === id)).toBe(true);
  });
  it("only shows the model clean examples", () => {
    for (const l of LISTENERS) for (const [a, b] of l.shots) expect(isClean(a) && isClean(b)).toBe(true);
  });
  it("ends every prompt with what was heard", () => {
    const p = promptFor(LISTENERS[0]!, "The bell rang twice.");
    expect(p[0]!.role).toBe("system");
    expect(p.at(-1)).toEqual({ role: "user", content: "Pass it on: The bell rang twice." });
  });
});

describe("cleaning", () => {
  it("tidies what a visitor types", () => {
    expect(cleanInput("  the dog   barked ")).toBe("The dog barked.");
    expect(cleanInput("<b>hi there</b>")).toBe("B hi there /b.");
    expect(cleanInput("!!!")).toBe("");
    expect(cleanInput("x".repeat(300)).length).toBeLessThanOrEqual(121);
  });
  it("turns away words that do not belong on a family page", () => {
    expect(isClean("The cat sat on the mat.")).toBe(true);
    expect(isClean("What the hell.")).toBe(false);
    expect(isClean("Hello, shell and class.")).toBe(true);
    expect(isClean("I will kill it.")).toBe(false);
    expect(isClean("A skilled baker.")).toBe(true);
  });
  it("keeps one or two sentences of model output and rejects junk", () => {
    expect(cleanOutput('"The cat left."\nUser: next', "x")).toBe("The cat left.");
    expect(cleanOutput("One. Two. Three. Four.", "x")).toBe("One. Two.");
    expect(cleanOutput("", "x")).toBe("");
    expect(cleanOutput("the the the the the the the the the the", "x")).toBe("");
    expect(cleanOutput("I cannot help with that.", "x")).toBe("");
    expect(cleanOutput("Well, damn it all.", "x")).toBe("");
  });
});

describe("drift", () => {
  it("is zero for the same sentence and one for a different one", () => {
    expect(drift("The cat sat on the mat.", "The cat sat on the mat.")).toBe(0);
    expect(drift("The cat sat on the mat.", "Breaking news: pizza!")).toBe(1);
  });
  it("ignores case, punctuation and plurals", () => {
    expect(similarity("Two cats sat.", "two cat sat")).toBe(1);
    expect(sameWords("The cat sat.", "the cat sat!")).toBe(true);
  });
  it("marks only the words that are new", () => {
    const d = diffWords("The cat sat on the mat.", "The cat sat on a golden hat.");
    expect(d.filter((p) => p.changed).map((p) => p.text)).toEqual(["a", "golden", "hat."]);
  });
});

describe("the light version", () => {
  it("gives every listener a different, clean rewrite for every suggestion", () => {
    for (const s of SUGGESTED) {
      for (const l of LISTENERS) {
        const out = lightRewrite(l.id, s, rngFrom(s + l.id));
        expect(out, `${l.id}: ${s}`).not.toBe(s);
        expect(isClean(out)).toBe(true);
        expect(out.split(" ").length).toBeLessThanOrEqual(25);
      }
    }
  });
  it("is the same for everyone given the same seed", () => {
    expect(lightRewrite("gossip", "The cat sat.", rngFrom("a"))).toBe(lightRewrite("gossip", "The cat sat.", rngFrom("a")));
  });
});

describe("a chain", () => {
  it("passes the sentence down the whole line and drifts", async () => {
    const steps = await collect(SUGGESTED[0]!, false);
    expect(steps).toHaveLength(10);
    expect(steps[0]!.heard).toBe(SUGGESTED[0]);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.heard).toBe(steps[i - 1]!.said);
    expect(steps.at(-1)!.drift).toBeGreaterThan(0.3);
  });
  it("drifts less when every listener is checked", async () => {
    for (const s of SUGGESTED) {
      const plain = await collect(s, false);
      const checked = await collect(s, true);
      expect(checked.every((c) => c.check !== undefined)).toBe(true);
      expect(checked.at(-1)!.drift).toBeLessThanOrEqual(plain.at(-1)!.drift);
    }
  });
  it("uses the model's words when the model answers, and the rule when it does not", async () => {
    const answers = ["A cat sat on the wall.", "", ""];
    const ask = async () => answers.shift() ?? "";
    const out: Step[] = [];
    for await (const s of runChain({ sentence: "A dog sat on the wall.", line: ["cat", "pirate"], careful: false, ask, rng: rngFrom("x") })) out.push(s);
    expect(out[0]).toMatchObject({ said: "A cat sat on the wall.", by: "model" });
    expect(out[1]!.by).toBe("light");
  });
  it("stops when cancelled", async () => {
    const signal = { cancelled: false };
    const out: Step[] = [];
    for await (const s of runChain({ sentence: "The cat sat.", line: DEFAULT_LINE, careful: false, ask: null, rng: rngFrom("x"), signal })) {
      out.push(s);
      signal.cancelled = true;
    }
    expect(out).toHaveLength(1);
  });
});

describe("share links", () => {
  it("carry a whole chain there and back", async () => {
    for (const careful of [false, true]) {
      const steps = await collect(SUGGESTED[1]!, careful);
      const back = decodeChain(encodeChain({ sentence: SUGGESTED[1]!, careful, steps }));
      expect(back).not.toBeNull();
      expect(back!.careful).toBe(careful);
      expect(back!.steps.map((s) => s.said)).toEqual(steps.map((s) => s.said));
      expect(back!.steps.map((s) => s.listener)).toEqual(steps.map((s) => s.listener));
      expect(back!.steps.map((s) => s.check?.passed)).toEqual(steps.map((s) => s.check?.passed));
    }
  });
  it("refuse anything broken or unclean", () => {
    expect(decodeChain("not-a-chain")).toBeNull();
    const bad = btoa(JSON.stringify({ v: 1, s: "What the hell.", l: "w", c: 0, t: ["Oh no."], b: "l" }));
    expect(decodeChain(bad)).toBeNull();
  });
});

describe("the daily sentence", () => {
  it("is the same all day and changes the next day, by the UTC calendar", () => {
    const a = new Date(Date.UTC(2026, 10, 11, 0, 5));
    const b = new Date(Date.UTC(2026, 10, 11, 23, 55));
    const c = new Date(Date.UTC(2026, 10, 12, 0, 5));
    expect(dailySentence(a)).toBe(dailySentence(b));
    expect(dailySentence(a)).not.toBe(dailySentence(c));
    expect(dayNumber(c) - dayNumber(a)).toBe(1);
    expect(isClean(dailySentence(a))).toBe(true);
  });
});
