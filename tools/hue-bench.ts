#!/usr/bin/env npx tsx
/// <reference lib="dom" />
/** Measure what a theme-hue change costs per frame.
 *  Usage: node tools/hue-bench.ts [page-match] [seconds] [--reload] [--sweep-only] [--inject=<css>] [--prop=<custom-property>] [--disable-css=<regex>] [--no-event] [--no-trace] [--drag]
 *  (Node's own TypeScript support; tsx runs it as CommonJS and rejects top-level await.)
 *
 *  Records two traces on the matched page: one idle, and one while
 *  the page itself sweeps --theme-hue once a frame (no mouse input;
 *  it also fires `phosphor:hue-change`, so hue-bound React state
 *  re-renders as in a drag). Restores the hue after. Saves both
 *  traces to traces/ (DevTools format, so trace-query reads them)
 *  and prints frame pacing and per-frame cost by thread.
 *
 *  The tab must be in the foreground: Chrome throttles rAF otherwise.
 */
import { writeFileSync } from "fs";
import { openSession } from "../src/session.ts";
import { findPage } from "../src/cdp.ts";
import { costByThread, forcedSites, frameStats, restyleStats, type TraceEvent } from "../src/frame-cost.ts";

const args = process.argv.slice(2);
const reload = args.includes("--reload");
const sweepOnly = args.includes("--sweep-only");
/** Measure frame pacing only. The tracer slows the page, so this is the true frame rate. */
const noTrace = args.includes("--no-trace");
/**
 * Sweep by dragging the page's HueStrip instead of writing the hue:
 * page-made pointer events run the real handlers, including every
 * other pointermove listener on the page.
 */
const drag = args.includes("--drag");
/** Skip the hue-change event, so no React state follows the sweep. */
const noEvent = args.includes("--no-event");
/** CSS added to the page before the runs, for what-if experiments. Removed after. */
const inject = args.find((a) => a.startsWith("--inject="))?.slice("--inject=".length);
/**
 * Stylesheets to switch off for the runs, by a regex on the Vite dev
 * id or the href. Switched back on after.
 */
const disableCss = args.find((a) => a.startsWith("--disable-css="))?.slice("--disable-css=".length);
/** The custom property the sweep writes. Another name measures a root change nothing reads. */
const prop = args.find((a) => a.startsWith("--prop="))?.slice("--prop=".length) ?? "--theme-hue";
const [match, secondsArg] = args.filter((a) => !a.startsWith("--"));
const seconds = Number(secondsArg) || 5;
/** Settle time after a reload, so loading work stays out of the idle trace. */
const SETTLE_MS = 3000;

const CATEGORIES = [
  "__metadata",
  "toplevel",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  // JS stacks on forced restyle and layout.
  "disabled-by-default-devtools.timeline.stack",
  "cc",
  "gpu",
  "viz",
];

/** Threads worth reporting: the renderer, its raster workers, the GPU process, the display compositor. */
const THREADS = /^(CrRendererMain|Compositor|CompositorTileWorker\d*|CrGpuMain|VizCompositorThread)$/;

const page = await findPage(match);
console.error(`Connected to: ${page.title} (${page.url})`);
const session = await openSession(page.webSocketDebuggerUrl);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (reload) await reloadPage();
await ensureVisible();
if (inject) await evaluateJson(injectScript(inject), 5_000);
if (disableCss) console.log(`disabled sheets: ${await evaluateJson<string>(toggleSheetsScript(disableCss, true), 5_000)}`);

for (const sweep of sweepOnly ? [true] : [false, true]) {
  const phase = sweep ? "sweep" : "idle";
  const { times, events } = await record(sweep, seconds * 1000);
  const file = noTrace ? "no trace" : `traces/hue-bench-${stamp}-${phase}.json`;
  if (!noTrace) writeFileSync(file, JSON.stringify({ traceEvents: events }));
  report(phase, times, events, file);
}
if (inject) await evaluateJson(`document.getElementById("hue-bench-inject")?.remove()`, 5_000);
if (disableCss) await evaluateJson(toggleSheetsScript(disableCss, false), 5_000);
session.close();

/** Sets `disabled` on each matching sheet; returns how many matched. */
function toggleSheetsScript(pattern: string, disabled: boolean): string {
  return `(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    let n = 0;
    for (const el of document.querySelectorAll("style, link[rel=stylesheet]")) {
      const id = el.getAttribute("data-vite-dev-id") ?? el.getAttribute("href") ?? "";
      if (!re.test(id) || !el.sheet) continue;
      el.sheet.disabled = ${disabled};
      n++;
    }
    return String(n);
  })()`;
}

function injectScript(css: string): string {
  return `(() => {
    const style = document.createElement("style");
    style.id = "hue-bench-inject";
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
  })()`;
}

// ─── Steps ──────────────────────────────────────────────────────────

/** A hidden tab gets no animation frames, so the run would never end. */
async function ensureVisible(): Promise<void> {
  await session.send("Page.bringToFront");
  const state = await evaluateJson<string>("document.visibilityState", 5_000);
  if (state !== "visible") {
    console.error("The tab is hidden (minimized window?). Show it and run again.");
    session.close();
    process.exit(1);
  }
}

async function reloadPage(): Promise<void> {
  await session.send("Page.enable");
  const loaded = new Promise<void>((resolve) => {
    const stop = session.on("Page.loadEventFired", () => {
      stop();
      resolve();
    });
  });
  await session.send("Page.reload", { ignoreCache: true });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

async function record(sweep: boolean, ms: number): Promise<{ times: number[]; events: TraceEvent[] }> {
  const events: TraceEvent[] = [];
  if (noTrace) return { times: await runPage(sweep, ms), events };
  const stopCollect = session.on("Tracing.dataCollected", (p) => events.push(...(p["value"] as TraceEvent[])));
  const complete = new Promise<void>((resolve) => {
    const stop = session.on("Tracing.tracingComplete", () => {
      stop();
      resolve();
    });
  });
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: CATEGORIES },
  });
  const times = await runPage(sweep, ms);
  await session.send("Tracing.end");
  await complete;
  stopCollect();
  return { times, events };
}

function runPage(sweep: boolean, ms: number): Promise<number[]> {
  // tsx compiles with keepNames, which can wrap inner functions in a
  // `__name` helper that does not exist in the page. Stub it there.
  const call = drag && sweep
    ? `(${dragInPage.toString()})(${ms})`
    : `(${runInPage.toString()})(${sweep}, ${ms}, ${JSON.stringify(prop)}, ${!noEvent})`;
  return evaluateJson<number[]>(`(() => { const __name = (f) => f; return ${call}; })()`, ms + 10_000);
}

/**
 * Runs inside the page. Drags the HueStrip nearest the viewport centre
 * back and forth, one pass a second, for `ms`. A move goes out after
 * each frame, as hand input would. Returns the frame timestamps.
 */
function dragInPage(ms: number): Promise<number[]> {
  const strips = [...document.querySelectorAll<HTMLElement>('[role="slider"].hue-strip')];
  const mid = innerHeight / 2;
  const distance = (el: HTMLElement) => Math.abs(el.getBoundingClientRect().top - mid);
  const strip = strips.sort((a, b) => distance(a) - distance(b))[0];
  if (!strip) return Promise.reject(new Error("no HueStrip on the page"));
  const rect = strip.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const pointer = (type: string, x: number) =>
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 });
  const xAt = (elapsed: number) => {
    const phase = (elapsed / 1000) % 2; // 0..2: right, then back
    const f = phase < 1 ? phase : 2 - phase;
    return rect.left + (0.05 + 0.9 * f) * rect.width;
  };
  strip.dispatchEvent(pointer("pointerdown", xAt(0)));
  const times: number[] = [];
  return new Promise((resolve) => {
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      times.push(now);
      if (now - t0 >= ms) {
        window.dispatchEvent(pointer("pointerup", xAt(now - t0)));
        resolve(times);
        return;
      }
      setTimeout(() => window.dispatchEvent(pointer("pointermove", xAt(performance.now() - t0))), 0);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function report(phase: string, times: number[], events: TraceEvent[], file: string): void {
  const f = frameStats(times);
  const ms = (n: number) => n.toFixed(2);
  console.log(`\n== ${phase}  (${file})`);
  console.log(
    `frames ${f.frames}  fps ${f.fps.toFixed(1)}  interval p50 ${ms(f.p50Ms)} p95 ${ms(f.p95Ms)} max ${ms(f.maxMs)} ms  long ${f.long}`,
  );
  const r = restyleStats(events, f.frames);
  console.log(
    `restyle ${r.perFrame.toFixed(1)}x/frame  ${r.elementsPerFrame.toFixed(0)} elements  ${ms(r.msPerFrame)} ms  ${r.usPerElement.toFixed(1)} us/element`,
  );
  for (const t of costByThread(events, f.frames, THREADS)) {
    console.log(`  ${t.thread}: ${ms(t.totalMs)} ms/frame`);
    for (const [name, cost] of t.top) console.log(`      ${ms(cost).padStart(6)}  ${name}`);
  }
  const forced = forcedSites(events, f.frames);
  if (forced.length) console.log("  forced by script:");
  for (const s of forced) console.log(`      ${ms(s.perFrameMs).padStart(6)}  ${s.perFrame.toFixed(1)}x  ${s.site}`);
}

/**
 * Runs inside the page. Steps one rAF loop for `ms`, writing a new hue
 * each frame when `sweep` is set, and returns the frame timestamps.
 */
function runInPage(sweep: boolean, ms: number, prop: string, notify: boolean): Promise<number[]> {
  const root = document.documentElement;
  const inline = root.style.getPropertyValue(prop);
  const base = parseFloat(getComputedStyle(root).getPropertyValue(prop)) || 82;
  const setHue = (hue: number) => {
    root.style.setProperty(prop, String(hue));
    if (notify && prop === "--theme-hue") window.dispatchEvent(new CustomEvent("phosphor:hue-change", { detail: hue }));
  };
  const times: number[] = [];
  // HueStrip raises this flag for the length of a drag.
  if (sweep) root.setAttribute("data-theme-dragging", "true");
  return new Promise((resolve) => {
    let t0 = -1;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      times.push(now);
      if (now - t0 >= ms) {
        if (sweep) {
          setHue(base);
          if (!inline) root.style.removeProperty(prop);
          root.removeAttribute("data-theme-dragging");
        }
        resolve(times);
        return;
      }
      // One full turn every 2 s, about the speed of a hand drag.
      if (sweep) setHue((base + (now - t0) * 0.18) % 360);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ─── CDP session ────────────────────────────────────────────────────

async function evaluateJson<T>(expression: string, timeoutMs: number): Promise<T> {
  const res = (await session.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  )) as { result?: { value?: T }; exceptionDetails?: unknown };
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result!.value as T;
}
