import "@fontsource-variable/anybody/wdth.css";
import "@fontsource-variable/schibsted-grotesk";
import "./styles.css";

import * as audio from "./audio";
import { cardBlob, drawCard } from "./card";
import { runChain, type Step } from "./core/chain";
import { cleanInput, isClean } from "./core/clean";
import { dailyLabel, dailySentence, SUGGESTED } from "./core/daily";
import { diffWords } from "./core/drift";
import { rngFrom } from "./core/light";
import { BY_ID, DEFAULT_LINE, LISTENERS } from "./core/listeners";
import { decodeChain, encodeChain, type Saved } from "./core/share";
import { Model } from "./model/client";
import { MODEL_MB, MODEL_NAME } from "./model/config";
import { Scene } from "./scene/scene";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`whisper:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`whisper:${key}`, value);
    } catch {
      /* private window */
    }
  },
};

/* ---------- state ---------- */

const allIds = LISTENERS.map((l) => l.id);
let order: string[] = (() => {
  const saved = (store.get("order") ?? "").split(",").filter((id) => BY_ID.has(id));
  const base = saved.length > 0 ? saved : DEFAULT_LINE;
  return [...new Set([...base, ...allIds])];
})();
let count = Math.max(3, Math.min(10, Number(store.get("count")) || 10));
let careful = store.get("careful") === "1";
let picked = "";
let mode: "intro" | "compose" | "play" | "end" = "intro";
let run: { skip: boolean; dead: boolean; wake: (() => void)[] } | null = null;
let lastSaved: Saved | null = null;
let lastRoundLight = false;
/** Drift of finished rounds, by sentence and line, so the two modes can be compared. */
const results = new Map<string, { plain?: number; careful?: number }>();

const line = () => order.slice(0, count);

const stage = $("stage");
const scene = new Scene($<HTMLCanvasElement>("scene"));
scene.reduced = reduced;
const model = new Model();

/* ---------- layout ---------- */

const centre = $("centre");
new ResizeObserver((entries) => {
  const box = entries[0]!.contentRect;
  scene.resize(box.width, box.height);
  centre.style.setProperty("--inner-w", `${Math.round(scene.ring.innerW)}px`);
  centre.style.setProperty("--inner-h", `${Math.round(scene.ring.innerH)}px`);
  centre.style.setProperty("--ring-y", `${Math.round(scene.ring.cy)}px`);
  placeTail();
}).observe(stage);
scene.setLine(line());

const panels = { intro: $("p-intro"), compose: $("p-compose"), play: $("p-play"), end: $("p-end") };
function show(name: keyof typeof panels): void {
  mode = name;
  document.body.dataset.mode = name;
  for (const [key, el] of Object.entries(panels)) {
    const on = key === name;
    el.hidden = !on;
    el.classList.toggle("is-on", false);
    if (on) requestAnimationFrame(() => el.classList.add("is-on"));
  }
  if (name !== "play") scene.setSpeaker("", null);
}

/* ---------- the model, arriving ---------- */

const awake = new Set<string>();
let waking = 0;
const statusText = $("status-text");
const statusEl = $("status");

function wakeGoal(): number {
  const s = model.state;
  if (s.phase === "light" || s.phase === "ready") return order.length;
  if (s.phase === "starting") return order.length - 1;
  if (s.phase === "downloading") return Math.min(order.length - 1, Math.floor((s.loaded / s.total) * order.length));
  return 0;
}

function wakeMore(all = false): void {
  const goal = all ? order.length : wakeGoal();
  if (awake.size >= goal || waking) return;
  const tick = () => {
    waking = 0;
    const target = all ? order.length : wakeGoal();
    const next = order.find((id) => !awake.has(id));
    if (!next || awake.size >= target) return;
    awake.add(next);
    scene.setAwake(next, true);
    if (line().includes(next)) {
      scene.bump(next, 1.5);
      audio.wake(awake.size - 1);
    }
    rosterEl.querySelector(`[data-id="${next}"]`)?.classList.add("is-awake");
    renderStatus();
    waking = window.setTimeout(tick, all ? 60 : 150);
  };
  waking = window.setTimeout(tick, 60);
}

const LIGHT_WHY: Record<string, string> = {
  "save-data": `your browser asks to save data, so the ${MODEL_MB} MB model was not fetched`,
  "no-webgpu": "this browser cannot run the model (it needs WebGPU)",
  "low-memory": "this device has too little memory for the model",
  phone: `this phone is not asked to hold a ${MODEL_MB} MB model`,
  error: "the model could not start on this device",
  asked: "you asked for it",
};

function renderStatus(): void {
  const s = model.state;
  let text = "";
  let tone = "wait";
  if (s.phase === "deciding") {
    text = "Checking what this device can run.";
  } else if (s.phase === "downloading") {
    const from = s.cached ? "from this browser's cache" : "from Hugging Face, once";
    const up = awake.size < order.length ? `Waking the listeners, ${awake.size} of ${order.length} up` : "The model is arriving";
    text = `${up}: ${MODEL_NAME}, ${s.loaded.toFixed(0)} of ${s.total.toFixed(0)} MB ${from}.`;
  } else if (s.phase === "starting") {
    text = `${MODEL_NAME} is here (${s.total.toFixed(0)} MB). Warming up on your graphics card.`;
  } else if (s.phase === "ready") {
    tone = "full";
    text = `Full version: ${MODEL_NAME} is running in this tab. Nothing you type leaves it.`;
  } else {
    tone = "light";
    text = `Light version: hand-written listeners, because ${LIGHT_WHY[s.reason] ?? "the model is not here"}.`;
  }
  if (mode === "play" || mode === "end") {
    if (lastSaved === null && run === null) {
      /* nothing playing */
    } else if (replaying) {
      tone = "light";
      text = "A saved chain, replayed exactly as it happened.";
    } else if (lastRoundLight && s.phase !== "light") {
      tone = "light";
      text =
        s.phase === "ready"
          ? `That round was the light version (hand-written listeners). ${MODEL_NAME} is ready now: the next one is real.`
          : `This round is the light version (hand-written listeners): the model is still arriving, ${s.loaded.toFixed(0)} of ${s.total.toFixed(0)} MB.`;
    }
  }
  statusText.textContent = text;
  statusEl.dataset.tone = tone;
}

model.subscribe(() => {
  renderStatus();
  wakeMore();
});

/* ---------- roster: count, order, swaps ---------- */

const rosterEl = $("roster");
const countEl = $("count");
const carefulEl = $<HTMLInputElement>("careful");
carefulEl.checked = careful;

function renderRoster(): void {
  rosterEl.textContent = "";
  order.forEach((id, i) => {
    const l = BY_ID.get(id)!;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chipper";
    b.dataset.id = id;
    b.style.setProperty("--c", l.colour);
    b.classList.toggle("is-bench", i >= count);
    b.classList.toggle("is-awake", awake.has(id));
    b.classList.toggle("is-picked", picked === id);
    b.setAttribute("aria-pressed", String(picked === id));
    b.innerHTML = `<span class="chipper-n">${i < count ? i + 1 : ""}</span><span class="chipper-dot"></span><span class="chipper-text"><b>${l.name}</b><small>${l.habit}</small></span>`;
    li.append(b);
    rosterEl.append(li);
  });
  countEl.textContent = String(count);
  $<HTMLButtonElement>("fewer").disabled = count <= 3;
  $<HTMLButtonElement>("more").disabled = count >= 10;
}

function saveLine(): void {
  store.set("order", order.join(","));
  store.set("count", String(count));
}

/** Re-lay the roster with each chip sliding from where it was. */
function flip(change: () => void): void {
  const before = new Map<string, DOMRect>();
  rosterEl.querySelectorAll<HTMLElement>(".chipper").forEach((el) => before.set(el.dataset.id!, el.getBoundingClientRect()));
  change();
  renderRoster();
  scene.setLine(line());
  if (reduced) return;
  rosterEl.querySelectorAll<HTMLElement>(".chipper").forEach((el) => {
    const a = before.get(el.dataset.id!);
    const b = el.getBoundingClientRect();
    if (!a || (a.left === b.left && a.top === b.top)) return;
    el.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], {
      duration: 420,
      easing: "cubic-bezier(.2,.9,.2,1)",
    });
  });
}

const busy = () => mode === "play" || mode === "intro";

function pick(id: string): void {
  if (busy() || id === "you" || !BY_ID.has(id)) return;
  audio.unlock();
  audio.tap();
  if (!picked) {
    picked = id;
  } else if (picked === id) {
    picked = "";
  } else {
    const a = order.indexOf(picked);
    const b = order.indexOf(id);
    picked = "";
    flip(() => {
      [order[a], order[b]] = [order[b]!, order[a]!];
    });
    saveLine();
    for (const moved of [order[a]!, order[b]!]) if (line().includes(moved)) scene.bump(moved, 1.2);
  }
  scene.setSelected(picked);
  rosterEl.querySelectorAll<HTMLElement>(".chipper").forEach((el) => {
    el.classList.toggle("is-picked", el.dataset.id === picked);
    el.setAttribute("aria-pressed", String(el.dataset.id === picked));
  });
  $("bar-hint").textContent = picked ? `Now tap who ${BY_ID.get(picked)!.name} should swap with.` : "Tap two listeners to swap them. The ones after the line are on the bench.";
}

rosterEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".chipper");
  if (b) pick(b.dataset.id!);
});
$<HTMLCanvasElement>("scene").addEventListener("click", (e) => {
  const rect = stage.getBoundingClientRect();
  const id = scene.hit(e.clientX - rect.left, e.clientY - rect.top);
  if (id) pick(id);
});

function setCount(n: number): void {
  if (busy()) return;
  audio.unlock();
  audio.tap();
  picked = "";
  scene.setSelected("");
  flip(() => {
    count = Math.max(3, Math.min(10, n));
  });
  saveLine();
}
$("fewer").addEventListener("click", () => setCount(count - 1));
$("more").addEventListener("click", () => setCount(count + 1));
$("shuffle").addEventListener("click", () => {
  if (busy()) return;
  audio.unlock();
  audio.tap();
  picked = "";
  scene.setSelected("");
  flip(() => {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  });
  saveLine();
});
carefulEl.addEventListener("change", () => {
  careful = carefulEl.checked;
  store.set("careful", careful ? "1" : "0");
  audio.unlock();
  audio.tap();
});

/* ---------- compose ---------- */

const input = $<HTMLInputElement>("say-input");
const chipsEl = $("chips");

function renderChips(): void {
  chipsEl.textContent = "";
  const daily = dailySentence();
  const pool = [...SUGGESTED].sort(() => Math.random() - 0.5).slice(0, 3);
  const add = (text: string, label: string, cls: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip ${cls}`;
    b.dataset.text = text;
    b.innerHTML = label ? `<span class="chip-tag">${label}</span><span></span>` : "<span></span>";
    b.lastElementChild!.textContent = text;
    chipsEl.append(b);
  };
  add(daily, `Today, ${dailyLabel()}`, "chip-daily");
  pool.forEach((s, i) => add(s, "", i === 2 ? "chip-extra" : ""));
}

chipsEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".chip");
  if (!b) return;
  audio.unlock();
  void play(b.dataset.text!);
});

$("p-compose").addEventListener("submit", (e) => {
  e.preventDefault();
  audio.unlock();
  const text = cleanInput(input.value);
  if (!text || !isClean(text)) {
    input.value = "";
    input.placeholder = text ? "Let's keep it friendly. Try another." : "Type one sentence";
    panels.compose.classList.remove("nudge");
    void panels.compose.offsetWidth;
    panels.compose.classList.add("nudge");
    return;
  }
  input.blur();
  void play(text);
});

function compose(): void {
  killRun();
  scene.quiet();
  replaying = false;
  renderChips();
  show("compose");
  renderStatus();
  if (matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true });
}

/* ---------- the show ---------- */

const whoName = $("who-name");
const whoNote = $("who-note");
const sayEl = $("say");
const bubble = $("bubble");
const meterFill = $("meter-fill");
const meterNum = $("meter-num");
const trail = $("trail");
const trailList = $("trail-list");
let replaying = false;
let speakerId = "";

function killRun(): void {
  if (!run) return;
  run.dead = true;
  run.skip = true;
  run.wake.forEach((w) => w());
  run = null;
}

/** Wait, unless the round is being skipped. */
function wait(ms: number): Promise<void> {
  const r = run;
  if (!r || r.skip) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, reduced ? ms * 0.8 : ms);
    r.wake.push(done);
  });
}

function placeTail(): void {
  if (panels.play.hidden || !speakerId) return;
  const s = stage.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  scene.setSpeaker(speakerId, { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height });
}

function wordsInto(el: HTMLElement, heard: string | null, said: string, colour: string): void {
  el.textContent = "";
  el.style.setProperty("--c", colour);
  const pieces = heard === null ? said.split(/\s+/).map((text) => ({ text, changed: false })) : diffWords(heard, said);
  pieces.forEach((p, i) => {
    const span = document.createElement("span");
    span.className = p.changed ? "w new" : "w";
    span.style.animationDelay = `${i * 42}ms`;
    span.textContent = p.text;
    el.append(span, " ");
  });
  const len = said.length;
  el.dataset.size = len > 110 ? "s" : len > 64 ? "m" : "l";
}

function speak(id: string, name: string, colour: string, note: string, heard: string | null, said: string, state = ""): void {
  speakerId = id;
  bubble.style.setProperty("--c", colour);
  bubble.dataset.state = state;
  whoName.textContent = name;
  whoNote.textContent = note;
  wordsInto(sayEl, heard, said, colour);
  bubble.classList.remove("pop");
  void bubble.offsetWidth;
  bubble.classList.add("pop");
  placeTail();
}

function thinking(id: string, name: string, colour: string, note: string): void {
  speakerId = id;
  bubble.style.setProperty("--c", colour);
  bubble.dataset.state = "thinking";
  whoName.textContent = name;
  whoNote.textContent = note;
  sayEl.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  sayEl.dataset.size = "l";
  placeTail();
}

function setMeter(d: number): void {
  meterFill.style.transform = `scaleX(${Math.max(0.02, d)})`;
  meterNum.textContent = `${Math.round(d * 100)}%`;
  $("meter").dataset.level = d > 0.66 ? "high" : d > 0.33 ? "mid" : "low";
}

function trailRow(step: Step, i: number): void {
  const l = BY_ID.get(step.listener)!;
  const li = document.createElement("li");
  li.className = "row";
  li.style.setProperty("--c", l.colour);
  const head = document.createElement("div");
  head.className = "row-head";
  head.innerHTML = `<span class="row-n">${i + 1}</span><span class="row-dot"></span><b>${l.name}</b><span class="row-by">${step.by === "model" ? "model" : "hand-written rule"}</span><span class="row-drift">${Math.round(step.drift * 100)}%</span>`;
  li.append(head);
  if (step.check && !step.check.passed) {
    const back = document.createElement("p");
    back.className = "row-back";
    wordsInto(back, step.heard, step.check.readBack, l.colour);
    const tag = document.createElement("span");
    tag.className = "row-tag bad";
    tag.textContent = "said back, caught by the check";
    back.prepend(tag);
    li.append(back);
  }
  const p = document.createElement("p");
  p.className = "row-said";
  wordsInto(p, step.heard, step.said, l.colour);
  if (step.check) {
    const tag = document.createElement("span");
    tag.className = `row-tag ${step.check.passed ? "ok" : "ok"}`;
    tag.textContent = step.check.passed ? "said back, passed the check" : "second try, passed on";
    p.prepend(tag);
  }
  li.append(p);
  trailList.append(li);
}

function trailStart(sentence: string): void {
  trailList.textContent = "";
  const li = document.createElement("li");
  li.className = "row row-you";
  li.innerHTML = '<div class="row-head"><span class="row-n">0</span><span class="row-dot"></span><b>You</b></div>';
  const p = document.createElement("p");
  p.className = "row-said";
  p.textContent = sentence;
  li.append(p);
  trailList.append(li);
  trail.hidden = false;
}

const dwell = (text: string) => Math.min(3000, 950 + text.split(" ").length * 115);

async function play(sentence: string, saved?: Saved, forceCareful?: boolean): Promise<void> {
  killRun();
  const me = { skip: false, dead: false, wake: [] as (() => void)[] };
  run = me;
  replaying = saved !== undefined;
  const isCareful = saved ? saved.careful : (forceCareful ?? careful);
  const ids = saved ? saved.steps.map((s) => s.listener) : line();
  const useModel = !saved && model.ready;
  lastRoundLight = !useModel;
  lastSaved = null;
  picked = "";
  scene.setSelected("");
  scene.quiet();
  wakeMore(true);
  show("play");
  renderStatus();
  setMeter(0);
  trailStart(sentence);
  document.body.classList.toggle("is-careful", isCareful);

  // Generation runs ahead of the show; the show takes steps as they exist.
  const got: Step[] = saved ? [...saved.steps] : [];
  let finished = saved !== undefined;
  let notify: (() => void)[] = [];
  if (!saved) {
    void (async () => {
      try {
        const chain = runChain({ sentence, line: ids, careful: isCareful, ask: useModel ? model.ask : null, rng: rngFrom(`${sentence}|${ids.join()}`), signal: { get cancelled() { return me.dead; } } });
        for await (const step of chain) {
          got.push(step);
          notify.forEach((n) => n());
          notify = [];
        }
      } finally {
        finished = true;
        notify.forEach((n) => n());
        notify = [];
      }
    })();
  }
  const stepAt = async (i: number): Promise<Step | null> => {
    while (!got[i] && !finished) await new Promise<void>((r) => notify.push(r));
    return got[i] ?? null;
  };

  speak("you", "You", "#ffffff", "say", null, sentence);
  scene.setTalking("you", true);
  await wait(dwell(sentence) * 0.8);
  scene.setTalking("you", false);

  let shown = 0;
  for (let i = 0; i < ids.length; i++) {
    if (me.dead) return;
    if (me.skip) break;
    const id = ids[i]!;
    const from = i === 0 ? "you" : ids[i - 1]!;
    const l = BY_ID.get(id)!;
    const fromName = i === 0 ? "You" : BY_ID.get(from)!.name;
    audio.whoosh();
    await Promise.race([scene.send(from, id), wait(1000)]);
    if (me.skip) break;
    thinking(id, l.name, l.colour, "listens");
    scene.setThinking(id, true);
    const step = await stepAt(i);
    scene.setThinking(id, false);
    if (me.dead) return;
    if (!step || me.skip) break;

    if (step.check) {
      speak(id, l.name, l.colour, "says it back", step.heard, step.check.readBack);
      scene.setTalking(id, true);
      audio.babble(l.pitch, step.check.readBack.split(" ").length);
      await wait(dwell(step.check.readBack) * 0.8);
      scene.setTalking(id, false);
      if (me.skip) break;
      audio.verdict(step.check.passed);
      if (step.check.passed) {
        bubble.dataset.state = "passed";
        whoNote.textContent = `${fromName} checks: close enough`;
        setMeter(step.drift);
        await wait(900);
      } else {
        bubble.dataset.state = "caught";
        whoNote.textContent = `${fromName} checks: not what I said`;
        scene.shake(from);
        await wait(1100);
        if (me.skip) break;
        audio.whoosh();
        await Promise.race([scene.send(from, id, 550), wait(600)]);
        speak(id, l.name, l.colour, "second try", step.heard, step.said, "passed");
        scene.setTalking(id, true);
        audio.babble(l.pitch, step.said.split(" ").length);
        setMeter(step.drift);
        await wait(dwell(step.said) * 0.7);
        scene.setTalking(id, false);
      }
    } else {
      speak(id, l.name, l.colour, "passes on", step.heard, step.said);
      scene.setTalking(id, true);
      audio.babble(l.pitch, step.said.split(" ").length);
      setMeter(step.drift);
      await wait(dwell(step.said));
      scene.setTalking(id, false);
    }
    trailRow(step, i);
    shown = i + 1;
  }

  // Skipped: let the writing finish, then show the rest in the list.
  if (me.skip && !me.dead) {
    scene.quiet();
    if (!finished) thinking(ids[Math.min(shown, ids.length - 1)]!, "The rest of the line", "#ffffff", "finishing");
    for (let i = shown; i < ids.length; i++) {
      const step = await stepAt(i);
      if (me.dead) return;
      if (step) trailRow(step, i);
    }
  }
  if (me.dead || got.length === 0) return;
  run = null;
  finish({ sentence, careful: isCareful, steps: got });
}

function finish(saved: Saved): void {
  lastSaved = saved;
  scene.quiet();
  const last = saved.steps.at(-1)!;
  const l = BY_ID.get(last.listener)!;
  const n = saved.steps.length;
  $("end-first").textContent = saved.sentence;
  const endLast = $("end-last");
  wordsInto(endLast, saved.sentence, last.said, l.colour);
  endLast.dataset.size = last.said.length > 110 ? "s" : last.said.length > 60 ? "m" : "l";
  panels.end.style.setProperty("--c", l.colour);
  $("end-label").textContent = `It came out, ${n} listeners later, as`;

  const key = `${saved.sentence}|${saved.steps.map((s) => s.listener).join()}`;
  const memo = results.get(key) ?? {};
  memo[saved.careful ? "careful" : "plain"] = last.drift;
  results.set(key, memo);
  const pct = (d: number) => `${Math.round(d * 100)}%`;
  let stat = `<b>${pct(last.drift)} drift</b> after ${n} hand-overs.`;
  if (saved.careful) {
    const caught = saved.steps.filter((s) => s.check && !s.check.passed).length;
    stat = `<b>${pct(last.drift)} drift</b> with checks. They caught ${caught} of ${n} hand-overs, and cost ${n + caught} extra messages.`;
    if (memo.plain !== undefined) stat += ` Without checks: ${pct(memo.plain)}.`;
  } else if (memo.careful !== undefined) {
    stat += ` With checks it was ${pct(memo.careful)}.`;
  }
  $("end-stat").innerHTML = stat;
  $("careful-cta").textContent = saved.careful ? "Try it without checks" : "Try it carefully";
  $("careful-cta").hidden = replaying;
  show("end");
  renderStatus();
  audio.finale();
  for (const s of saved.steps) scene.bump(s.listener, 1);
  if (!replaying) {
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch {
      /* file: or sandboxed */
    }
  }
}

$("skip").addEventListener("click", () => {
  if (!run) return;
  run.skip = true;
  run.wake.forEach((w) => w());
  run.wake = [];
});
$("again").addEventListener("click", () => compose());
$("replay").addEventListener("click", () => {
  if (lastSaved) void play(lastSaved.sentence, lastSaved);
});
$("careful-cta").addEventListener("click", () => {
  if (!lastSaved) return;
  const next = !lastSaved.careful;
  careful = next;
  carefulEl.checked = next;
  store.set("careful", next ? "1" : "0");
  void play(lastSaved.sentence, undefined, next);
});

/* ---------- share ---------- */

const sheet = $<HTMLDialogElement>("sheet");
const sheetImg = $<HTMLImageElement>("sheet-img");
let cardFile: File | null = null;

const shareUrl = (saved: Saved) => `${location.origin}${location.pathname}#c=${encodeChain(saved)}`;

$("share").addEventListener("click", async () => {
  if (!lastSaved) return;
  const canvas = await drawCard(lastSaved);
  const blob = await cardBlob(canvas);
  if (!blob) return;
  cardFile = new File([blob], "whisper.png", { type: "image/png" });
  if (sheetImg.src.startsWith("blob:")) URL.revokeObjectURL(sheetImg.src);
  sheetImg.src = URL.createObjectURL(blob);
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [cardFile] });
  $("sheet-share").textContent = canShare ? "Share picture" : "Save picture";
  $("sheet-link").textContent = "Copy replay link";
  sheet.showModal();
});
$("sheet-share").addEventListener("click", async () => {
  if (!cardFile || !lastSaved) return;
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ files: [cardFile] });
  if (canShare) {
    try {
      await navigator.share({ files: [cardFile], title: "Whisper", text: "Ten AIs played the telephone game with my sentence.", url: shareUrl(lastSaved) });
    } catch {
      /* closed the share sheet */
    }
    return;
  }
  const a = document.createElement("a");
  a.href = sheetImg.src;
  a.download = "whisper.png";
  a.click();
});
$("sheet-link").addEventListener("click", async () => {
  if (!lastSaved) return;
  const url = shareUrl(lastSaved);
  try {
    await navigator.clipboard.writeText(url);
    $("sheet-link").textContent = "Link copied";
  } catch {
    prompt("Copy this link", url);
  }
});
$("sheet-close").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (e) => {
  if (e.target === sheet) sheet.close();
});

/* ---------- sound ---------- */

const muteBtn = $("mute");
const paintMute = () => {
  muteBtn.setAttribute("aria-pressed", String(audio.isMuted()));
  muteBtn.setAttribute("aria-label", audio.isMuted() ? "Turn sound on" : "Mute sound");
};
paintMute();
muteBtn.addEventListener("click", () => {
  audio.unlock();
  audio.setMuted(!audio.isMuted());
  paintMute();
  audio.tap();
});
scene.onArrive = (id) => {
  const l = BY_ID.get(id);
  if (l) audio.land(l.pitch);
};

/* ---------- ten-second intro ---------- */

const introLine = $("intro-line");

function introWords(text: string): void {
  introLine.textContent = "";
  text.split(" ").forEach((w, i) => {
    const s = document.createElement("span");
    s.textContent = w;
    s.style.animationDelay = `${i * 90}ms`;
    introLine.append(s, " ");
  });
}

async function intro(): Promise<void> {
  const me = { skip: false, dead: false, wake: [] as (() => void)[] };
  run = me;
  show("intro");
  const stop = () => {
    me.skip = true;
    me.wake.forEach((w) => w());
  };
  stage.addEventListener("pointerdown", stop, { once: true });
  window.addEventListener("keydown", stop, { once: true });
  for (const text of ["Ten AIs.", "One sentence.", "Pass it on."]) {
    introWords(text);
    await wait(1050);
    if (me.skip) break;
  }
  if (!me.skip) {
    // A real three-step chain, small and quick, so the idea lands before any reading.
    show("play");
    mode = "intro";
    document.body.dataset.mode = "intro";
    const demo = "The cat sat on the mat.";
    const ids = line().slice(0, 3);
    const rng = rngFrom("intro");
    speak("you", "You", "#ffffff", "say", null, demo);
    setMeter(0);
    await wait(1100);
    let heard = demo;
    let i = 0;
    for await (const step of runChain({ sentence: demo, line: ids, careful: false, ask: null, rng })) {
      if (me.skip) break;
      const l = BY_ID.get(step.listener)!;
      const from = i === 0 ? "you" : ids[i - 1]!;
      scene.setAwake(step.listener, true);
      await Promise.race([scene.send(from, step.listener, 700), wait(760)]);
      if (me.skip) break;
      speak(step.listener, l.name, l.colour, "passes on", heard, step.said);
      scene.setTalking(step.listener, true);
      setMeter(step.drift);
      await wait(1500);
      scene.setTalking(step.listener, false);
      heard = step.said;
      i++;
    }
    // Listeners the intro borrowed go back to sleep unless the model has woken them.
    for (const id of ids) if (!awake.has(id)) scene.setAwake(id, false);
  }
  stage.removeEventListener("pointerdown", stop);
  window.removeEventListener("keydown", stop);
  if (me.dead) return;
  run = null;
  store.set("seen", "1");
  compose();
}

/* ---------- start ---------- */

renderRoster();
renderStatus();
void model.start();

const code = /[#&]c=([\w-]+)/.exec(location.hash)?.[1];
const linked = code ? decodeChain(code) : null;
if (linked) {
  // A shared chain: put its listeners on the line for this visit and play it back.
  const ids = linked.steps.map((s) => s.listener);
  if (new Set(ids).size === ids.length && ids.length >= 1) {
    order = [...ids, ...allIds.filter((id) => !ids.includes(id))];
    count = Math.max(1, Math.min(12, ids.length));
    renderRoster();
    scene.setLine(line());
    show("play");
    window.setTimeout(() => void play(linked.sentence, linked), 500);
  } else {
    compose();
  }
} else if (reduced || store.get("seen") === "1" || new URLSearchParams(location.search).has("nointro")) {
  compose();
} else {
  void intro();
}

// A hook for the capture scripts and the curious: window.whisper.
(window as unknown as { whisper: unknown }).whisper = { model, scene, play: (s: string) => play(cleanInput(s)), state: () => ({ mode, lastSaved, lastRoundLight }) };
