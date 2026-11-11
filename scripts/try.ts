/**
 * Prompt bench: runs sentences down the line in Node so the personalities can
 * be tuned without a browser. `npx tsx scripts/try.ts [model] [dtype]`.
 */
import { pipeline, type TextGenerationPipeline } from "@huggingface/transformers";
import { BY_ID, DEFAULT_LINE, LISTENERS, promptFor } from "../src/core/listeners";
import { cleanOutput } from "../src/core/clean";
import { GEN } from "../src/model/config";

const model = process.argv[2] ?? "HuggingFaceTB/SmolLM2-360M-Instruct";
const dtype = process.argv[3] ?? "q4";
const mode = process.argv[4] ?? "chain";

const SENTENCES = [
  "The cat sat on the warm windowsill.",
  "We are having pancakes for dinner on Friday.",
  "The meeting is moved to three o'clock tomorrow.",
  "My dog ate seven socks and feels fine.",
  "Please water the plants while I am away.",
  "The rocket will launch at sunrise.",
];

const gen = (await pipeline("text-generation", model, { dtype: dtype as "q4" })) as TextGenerationPipeline;

async function pass(id: string, heard: string): Promise<{ raw: string; clean: string }> {
  const l = BY_ID.get(id)!;
  const out = (await gen(promptFor(l, heard) as never, { ...GEN })) as { generated_text: { content: string }[] }[];
  const raw = out[0]!.generated_text.at(-1)!.content;
  return { raw, clean: cleanOutput(raw, heard) };
}

if (mode === "each") {
  for (const l of LISTENERS) {
    console.log(`\n## ${l.name}`);
    for (const s of SENTENCES) {
      const t = Date.now();
      const r = await pass(l.id, s);
      console.log(`  ${s}\n    -> ${r.clean || `[REJECTED] ${JSON.stringify(r.raw)}`}  (${Date.now() - t} ms)`);
    }
  }
} else {
  for (const s of SENTENCES) {
    console.log(`\n# ${s}`);
    let cur = s;
    for (const id of DEFAULT_LINE) {
      const r = await pass(id, cur);
      console.log(`  ${BY_ID.get(id)!.name.padEnd(16)} ${r.clean || `[REJECTED] ${JSON.stringify(r.raw)}`}`);
      if (r.clean) cur = r.clean;
    }
  }
}
