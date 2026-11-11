/**
 * One game: a sentence handed down a line of listeners. The chain does not
 * know about drawing or sound; it produces steps and the page presents them.
 */
import { cleanOutput } from "./clean";
import { drift, sameWords, similarity } from "./drift";
import { lightRepeat, lightRewrite, type Rng } from "./light";
import { BY_ID, promptFor, repeatPrompt, type ChatMessage } from "./listeners";

/** Asks the model for one reply. `hot` asks for a livelier sample. */
export type Ask = (messages: ChatMessage[], mode: "normal" | "hot" | "exact") => Promise<string>;

export interface Step {
  listener: string;
  heard: string;
  /** What this listener passed on. */
  said: string;
  /** Who wrote `said`: the model, or the hand-built rule. */
  by: "model" | "light";
  /** Careful mode: what the listener said back first, and whether the check let it through. */
  check?: { readBack: string; passed: boolean };
  /** Drift from the very first sentence after this step, 0 to 1. */
  drift: number;
}

export interface ChainInput {
  sentence: string;
  line: string[];
  careful: boolean;
  /** The model, or null to play the light version. */
  ask: Ask | null;
  rng: Rng;
  signal?: { cancelled: boolean };
}

/** A read-back closer than this to what was said is let through. */
export const CHECK_PASS = 0.8;

async function bend(listener: string, heard: string, ask: Ask | null, rng: Rng): Promise<{ text: string; by: "model" | "light" }> {
  const l = BY_ID.get(listener);
  if (ask && l) {
    try {
      let text = cleanOutput(await ask(promptFor(l, heard), "normal"), heard);
      // A plain repeat or an unusable reply gets one livelier second go.
      if (!text || sameWords(text, heard)) {
        const again = cleanOutput(await ask(promptFor(l, heard), "hot"), heard);
        if (again) text = again;
      }
      if (text) return { text, by: "model" };
    } catch {
      /* fall through to the hand-built habit */
    }
  }
  return { text: lightRewrite(listener, heard, rng), by: "light" };
}

async function sayBack(heard: string, ask: Ask | null, rng: Rng): Promise<{ text: string; by: "model" | "light" }> {
  if (ask) {
    try {
      const text = cleanOutput(await ask(repeatPrompt(heard), "exact"), heard);
      if (text) return { text, by: "model" };
    } catch {
      /* fall through */
    }
  }
  return { text: lightRepeat(heard, rng), by: "light" };
}

/** Run the whole line, yielding each step as soon as it exists. */
export async function* runChain(input: ChainInput): AsyncGenerator<Step> {
  let heard = input.sentence;
  for (const listener of input.line) {
    if (input.signal?.cancelled) return;
    const first = await bend(listener, heard, input.ask, input.rng);
    let step: Step;
    if (!input.careful) {
      step = { listener, heard, said: first.text, by: first.by, drift: 0 };
    } else if (similarity(heard, first.text) >= CHECK_PASS && similarity(first.text, heard) >= CHECK_PASS) {
      step = { listener, heard, said: first.text, by: first.by, check: { readBack: first.text, passed: true }, drift: 0 };
    } else {
      const second = await sayBack(heard, input.ask, input.rng);
      step = { listener, heard, said: second.text, by: second.by, check: { readBack: first.text, passed: false }, drift: 0 };
    }
    step.drift = drift(input.sentence, step.said);
    if (input.signal?.cancelled) return;
    yield step;
    heard = step.said;
  }
}
