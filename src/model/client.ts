/**
 * The page's side of the model: decide whether this device should load it at
 * all, start it without being asked, report honest progress, and answer.
 */
import type { ChatMessage } from "../core/listeners";
import { MODEL_ID, MODEL_MB } from "./config";
import type { FromWorker, ToWorker } from "./worker";

export type Phase = "deciding" | "downloading" | "starting" | "ready" | "light";

/** Why the light version is playing, when it is. */
export type LightReason = "" | "save-data" | "no-webgpu" | "low-memory" | "phone" | "error" | "asked";

export interface ModelState {
  phase: Phase;
  /** Megabytes fetched so far and expected in total. */
  loaded: number;
  total: number;
  /** True when the weights were already in this browser's cache. */
  cached: boolean;
  reason: LightReason;
  error: string;
}

interface Gpu {
  requestAdapter(): Promise<{ features: Set<string> } | null>;
}

async function decide(): Promise<LightReason> {
  const q = new URLSearchParams(location.search);
  if (q.has("light")) return "asked";
  const full = q.has("full");
  const nav = navigator as Navigator & { gpu?: Gpu; deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData && !full) return "save-data";
  try {
    const adapter = await nav.gpu?.requestAdapter();
    if (!adapter || !adapter.features.has("shader-f16")) return "no-webgpu";
  } catch {
    return "no-webgpu";
  }
  if (full) return "";
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return "low-memory";
  // Phones that do not say how much memory they have are not asked to hold the model.
  if (nav.deviceMemory === undefined && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return "phone";
  return "";
}

async function isCached(): Promise<boolean> {
  try {
    if (!("caches" in self)) return false;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((k) => k.url.includes(MODEL_ID) && k.url.endsWith(".onnx"));
  } catch {
    return false;
  }
}

export class Model {
  state: ModelState = { phase: "deciding", loaded: 0, total: MODEL_MB, cached: false, reason: "", error: "" };
  private worker: Worker | null = null;
  private files = new Map<string, { loaded: number; total: number }>();
  private waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private listeners = new Set<() => void>();

  get ready(): boolean {
    return this.state.phase === "ready";
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  private set(patch: Partial<ModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Called once, as the page opens. Nobody has to press anything. */
  async start(): Promise<void> {
    const reason = await decide();
    if (reason) {
      this.set({ phase: "light", reason });
      return;
    }
    this.set({ phase: "downloading", cached: await isCached() });
    try {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
      worker.onerror = (e) => this.fail(e.message || "the model worker stopped");
      worker.postMessage({ type: "load" } satisfies ToWorker);
    } catch (err) {
      this.fail(String((err as Error)?.message ?? err));
    }
  }

  private fail(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.reject(new Error(message));
    this.waiting.clear();
    this.set({ phase: "light", reason: "error", error: message });
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case "progress": {
        this.files.set(msg.file, { loaded: msg.loaded, total: msg.total });
        let loaded = 0;
        let total = 0;
        for (const f of this.files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        if (this.state.phase === "downloading") this.set({ loaded: loaded / 1e6, total: Math.max(total / 1e6, MODEL_MB) });
        break;
      }
      case "starting":
        this.set({ phase: "starting", loaded: this.state.total });
        break;
      case "ready":
        this.set({ phase: "ready" });
        break;
      case "error":
        this.fail(msg.message);
        break;
      case "answer":
        this.waiting.get(msg.id)?.resolve(msg.text);
        this.waiting.delete(msg.id);
        break;
      case "ask-error":
        this.waiting.get(msg.id)?.reject(new Error(msg.message));
        this.waiting.delete(msg.id);
        break;
    }
  }

  ask = (messages: ChatMessage[], mode: "normal" | "hot" | "exact"): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!this.worker || !this.ready) return reject(new Error("the model is not running"));
      const id = this.nextId++;
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ type: "ask", id, messages, mode } satisfies ToWorker);
    });
}
