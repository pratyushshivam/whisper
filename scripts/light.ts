/** Eyeball the light version: `npx tsx scripts/light.ts`. */
import { runChain } from "../src/core/chain";
import { SUGGESTED } from "../src/core/daily";
import { rngFrom } from "../src/core/light";
import { DEFAULT_LINE, LISTENERS } from "../src/core/listeners";

const careful = process.argv.includes("careful");
for (const s of SUGGESTED) {
  console.log(`\n# ${s}`);
  const line = process.argv.includes("all") ? LISTENERS.map((l) => l.id) : DEFAULT_LINE;
  for await (const step of runChain({ sentence: s, line, careful, ask: null, rng: rngFrom(s) })) {
    console.log(`  ${step.listener.padEnd(12)} ${step.check ? (step.check.passed ? "ok " : "NO ") : ""}${step.said}  [${Math.round(step.drift * 100)}%]`);
  }
}
