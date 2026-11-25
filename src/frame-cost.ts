/** Pure summaries of a recorded run: frame pacing, and where each frame's time goes. */

export interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string };
}

export interface FrameStats {
  frames: number;
  fps: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Frame intervals over 20 ms: a missed 60 Hz frame. */
  long: number;
}

export interface ThreadCost {
  thread: string;
  /** Busy time per frame, ms. */
  totalMs: number;
  /** Self time per frame by event name, ms, largest first. */
  top: [string, number][];
}

/** Pacing of a run from its requestAnimationFrame timestamps (ms). */
export function frameStats(times: number[]): FrameStats {
  const gaps = times.slice(1).map((t, i) => t - times[i]!).sort((a, b) => a - b);
  const span = times.length > 1 ? times[times.length - 1]! - times[0]! : 0;
  return {
    frames: gaps.length,
    fps: span > 0 ? (gaps.length * 1000) / span : 0,
    p50Ms: quantile(gaps, 0.5),
    p95Ms: quantile(gaps, 0.95),
    maxMs: gaps[gaps.length - 1] ?? 0,
    long: gaps.filter((g) => g > 20).length,
  };
}

/**
 * Per-frame cost of each thread whose name matches, busiest first.
 * Threads under `minMs` per frame are dropped.
 */
export function costByThread(
  events: TraceEvent[],
  frames: number,
  match: RegExp,
  { top = 6, minMs = 0.2 } = {},
): ThreadCost[] {
  const names = threadNames(events);
  const perFrame = (us: number) => us / 1000 / Math.max(1, frames);
  const costs: ThreadCost[] = [];
  for (const [key, spans] of groupByThread(events)) {
    const name = names.get(key);
    if (!name || !match.test(name)) continue;
    const self = [...selfTimes(spans)].map(([n, us]): [string, number] => [n, perFrame(us)]);
    const totalMs = self.reduce((sum, [, ms]) => sum + ms, 0);
    if (totalMs < minMs) continue;
    self.sort((a, b) => b[1] - a[1]);
    costs.push({ thread: `${name} (${key})`, totalMs, top: self.slice(0, top) });
  }
  return costs.sort((a, b) => b.totalMs - a.totalMs);
}

/**
 * Self time by event name, in µs: each span's duration minus its
 * direct children's. Spans must come from one thread.
 */
export function selfTimes(spans: TraceEvent[]): Map<string, number> {
  const sorted = spans
    .filter((e) => e.ph === "X" && e.dur !== undefined)
    .sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
  const self = new Map<string, number>();
  const stack: { end: number; name: string }[] = [];
  for (const e of sorted) {
    while (stack.length && stack[stack.length - 1]!.end <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) self.set(parent.name, (self.get(parent.name) ?? 0) - e.dur!);
    self.set(e.name, (self.get(e.name) ?? 0) + e.dur!);
    stack.push({ end: e.ts + e.dur!, name: e.name });
  }
  return self;
}

export interface RestyleStats {
  perFrame: number;
  /** Elements restyled per frame, summed over that frame's restyles. */
  elementsPerFrame: number;
  msPerFrame: number;
  usPerElement: number;
}

/** How much restyle work each frame does, from `UpdateLayoutTree` element counts. */
export function restyleStats(events: TraceEvent[], frames: number): RestyleStats {
  let count = 0;
  let elements = 0;
  let us = 0;
  for (const e of events) {
    if (e.name !== "UpdateLayoutTree" || e.ph !== "X") continue;
    count++;
    elements += (e.args as { elementCount?: number } | undefined)?.elementCount ?? 0;
    us += e.dur ?? 0;
  }
  const n = Math.max(1, frames);
  return {
    perFrame: count / n,
    elementsPerFrame: elements / n,
    msPerFrame: us / 1000 / n,
    usPerElement: elements > 0 ? us / elements : 0,
  };
}

export interface ForcedSite {
  /** Event name and the top JS frames that forced it. */
  site: string;
  perFrame: number;
  perFrameMs: number;
}

/**
 * Restyles and layouts that script forced, grouped by the JS call
 * site, costliest first. Needs the `devtools.timeline.stack` category.
 */
export function forcedSites(events: TraceEvent[], frames: number, top = 5): ForcedSite[] {
  const sites = new Map<string, { n: number; us: number }>();
  for (const e of events) {
    if (e.name !== "Layout" && e.name !== "UpdateLayoutTree") continue;
    const stack = (e.args as { beginData?: { stackTrace?: StackFrame[] } } | undefined)?.beginData?.stackTrace;
    if (!stack?.length) continue;
    const site = `${e.name}: ${stack.slice(0, 2).map(frameLabel).join(" < ")}`;
    const s = sites.get(site) ?? { n: 0, us: 0 };
    s.n++;
    s.us += e.dur ?? 0;
    sites.set(site, s);
  }
  const n = Math.max(1, frames);
  return [...sites]
    .map(([site, s]) => ({ site, perFrame: s.n / n, perFrameMs: s.us / 1000 / n }))
    .sort((a, b) => b.perFrameMs - a.perFrameMs)
    .slice(0, top);
}

interface StackFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
}

function frameLabel(f: StackFrame): string {
  const file = String(f.url ?? "").split("/").pop()!.split("?")[0];
  return `${f.functionName || "(anon)"} ${file}:${f.lineNumber}`;
}

function threadNames(events: TraceEvent[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name" && e.args?.name) names.set(threadKey(e), e.args.name);
  }
  return names;
}

function groupByThread(events: TraceEvent[]): Map<string, TraceEvent[]> {
  const groups = new Map<string, TraceEvent[]>();
  for (const e of events) {
    if (e.ph !== "X") continue;
    const key = threadKey(e);
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

function threadKey(e: TraceEvent): string {
  return `${e.pid}:${e.tid}`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
