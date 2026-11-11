/// <reference lib="webworker" />
/**
 * The model lives here, off the main thread, so the page keeps moving while
 * it downloads, compiles and writes.
 */
import { pipeline, type TextGenerationPipeline } from "@huggingface/transformers";
import type { ChatMessage } from "../core/listeners";
import { GEN, MODEL_DTYPE, MODEL_ID } from "./config";

export type ToWorker = { type: "load" } | { type: "ask"; id: number; messages: ChatMessage[]; mode: "normal" | "hot" | "exact" };

export type FromWorker =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "starting" }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "answer"; id: number; text: string }
  | { type: "ask-error"; id: number; message: string };

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m);
let gen: TextGenerationPipeline | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function ask(messages: ChatMessage[], mode: "normal" | "hot" | "exact"): Promise<string> {
  if (!gen) throw new Error("the model is not loaded");
  const options =
    mode === "exact"
      ? { max_new_tokens: GEN.max_new_tokens, do_sample: false }
      : mode === "hot"
        ? { ...GEN, temperature: 0.95 }
        : { ...GEN };
  const out = (await gen(messages as never, options as never)) as { generated_text: { role: string; content: string }[] }[];
  return out[0]?.generated_text.at(-1)?.content ?? "";
}

async function load(): Promise<void> {
  gen = (await pipeline("text-generation", MODEL_ID, {
    device: "webgpu",
    dtype: MODEL_DTYPE,
    progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status === "progress" && e.file && e.total) post({ type: "progress", file: e.file, loaded: e.loaded ?? 0, total: e.total });
    },
  } as never)) as unknown as TextGenerationPipeline;
  post({ type: "starting" });
  // One real answer before saying ready: a model that loads but cannot write
  // (a graphics driver missing an operation, say) should fail here, quietly.
  const first = await ask([{ role: "user", content: "Say hello." }], "exact");
  if (first.trim().length === 0) throw new Error("the model wrote nothing");
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === "load") {
    queue = queue.then(async () => {
      try {
        await load();
        post({ type: "ready" });
      } catch (err) {
        post({ type: "error", message: String((err as Error)?.message ?? err) });
      }
    });
  } else {
    queue = queue.then(async () => {
      try {
        post({ type: "answer", id: msg.id, text: await ask(msg.messages, msg.mode) });
      } catch (err) {
        post({ type: "ask-error", id: msg.id, message: String((err as Error)?.message ?? err) });
      }
    });
  }
};
