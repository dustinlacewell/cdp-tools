import { TraceStore } from "../trace-store.ts";
import { fmtMs, table } from "../format.ts";
import type { ProfileNode, ProfileSample } from "../types.ts";

export interface ProfileEntry {
  name: string;
  url: string;
  line: number;
  selfMs: number;
  totalMs: number;
  samples: number;
}

interface ProfileResult {
  entries: ProfileEntry[];
  totalSamples: number;
  matchedSamples: number;
  matchedMs: number;
}

function eligible(node: ProfileNode, origin: RegExp | null): boolean {
  const frame = node.callFrame;
  if (origin) return !!frame.url && origin.test(frame.url);
  return frame.functionName !== "(idle)" && frame.functionName !== "(root)";
}

function identity(node: ProfileNode): string {
  const frame = node.callFrame;
  return `${frame.url}:${frame.functionName}:${frame.lineNumber}`;
}

function entryOf(node: ProfileNode): ProfileEntry {
  const frame = node.callFrame;
  return { name: frame.functionName || "(anonymous)", url: frame.url,
    line: frame.lineNumber, selfMs: 0, totalMs: 0, samples: 0 };
}

/** Sampled self and inclusive time. Node lookup and ancestry stay within a profile. */
export function profileData(store: TraceStore, opts: { origin?: string; within?: string }, samples = store.filteredProfileSamples(opts)): ProfileResult {
  const origin = opts.origin ? new RegExp(opts.origin, "i") : null;
  const byFunc = new Map<string, ProfileEntry>();
  let matchedSamples = 0;
  let matchedMs = 0;
  const add = (node: ProfileNode, sample: ProfileSample, self: boolean): void => {
    if (!eligible(node, origin)) return;
    const key = identity(node);
    const entry = byFunc.get(key) ?? entryOf(node);
    const ms = sample.durationUs / 1000;
    entry.totalMs += ms;
    if (self) { entry.selfMs += ms; entry.samples++; }
    byFunc.set(key, entry);
  };
  for (const sample of samples) {
    const leaf = store.profileNode(sample);
    if (!leaf) continue;
    let matched = false;
    const seenNodes = new Set<number>();
    const seenFunctions = new Set<string>();
    let current: number | undefined = sample.nodeId;
    let self = true;
    while (current !== undefined && !seenNodes.has(current)) {
      seenNodes.add(current);
      const node: ProfileNode | undefined = store.profileNodes.get(sample.profileKey)?.get(current);
      if (!node) break;
      matched ||= eligible(node, origin);
      const key = identity(node);
      // Recursive calls count once in inclusive time for one sampled stack.
      if (!seenFunctions.has(key)) add(node, sample, self);
      seenFunctions.add(key);
      current = node.parent;
      self = false;
    }
    if (matched) { matchedSamples++; matchedMs += sample.durationUs / 1000; }
  }
  return { entries: [...byFunc.values()].sort((a, b) => b.selfMs - a.selfMs),
    totalSamples: store.profileSamples.length, matchedSamples, matchedMs };
}

function source(f: Pick<ProfileEntry, "url" | "line">): string {
  const short = f.url ? f.url.split("/").pop() ?? f.url : "";
  return f.line >= 0 ? `${short}:${f.line + 1}` : short;
}

function filters(opts: { origin?: string; within?: string }): string {
  const parts = [];
  if (opts.origin) parts.push(`origin: ${opts.origin}`);
  if (opts.within) parts.push(`within: ${opts.within}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function profile(store: TraceStore, opts: { limit: number; origin?: string; within?: string }): string {
  if (!store.profileSamples.length) return "No CPU profile samples found. Record with 'Performance' tab in DevTools.";
  const data = profileData(store, opts);
  if (!data.entries.length) return "No matching profile samples.";
  const selfMs = data.entries.reduce((sum, entry) => sum + entry.selfMs, 0);
  const selfSamples = data.entries.reduce((sum, entry) => sum + entry.samples, 0);
  return [
    `CPU Profile: ${data.totalSamples} total samples, ${selfSamples} matching self samples${filters(opts)}`,
    `Matched self time: ~${fmtMs(selfMs)}\n`,
    table(["Function", "Self Time", "Self %", "Samples", "Source"],
      data.entries.slice(0, opts.limit).map((f) => [f.name, fmtMs(f.selfMs),
        `${selfMs ? (100 * f.selfMs / selfMs).toFixed(1) : "0.0"}%`, String(f.samples), source(f)]),
      ["l", "r", "r", "r", "l"]),
  ].join("\n");
}

export function profileHeavy(store: TraceStore, opts: { limit: number; origin?: string; within?: string }): string {
  const data = profileData(store, opts);
  if (!data.entries.length) return "No matching profile samples.";
  const entries = [...data.entries].sort((a, b) => b.totalMs - a.totalMs);
  return [
    `Heavy (Bottom-Up) Profile: ${data.totalSamples} total samples, ${data.matchedSamples} matched${filters(opts)}`,
    `Matched sampled time: ~${fmtMs(data.matchedMs)}\n`,
    table(["Function", "Total", "Total %", "Self", "Self %", "Source"],
      entries.slice(0, opts.limit).map((f) => [f.name, fmtMs(f.totalMs),
        `${(100 * f.totalMs / data.matchedMs).toFixed(1)}%`, fmtMs(f.selfMs),
        `${(100 * f.selfMs / data.matchedMs).toFixed(1)}%`, source(f)]),
      ["l", "r", "r", "r", "r", "l"]),
  ].join("\n");
}

/** List instrumented FunctionCall events with invocation counts. */
export function functionRows(store: TraceStore, opts: {
  limit: number; origin?: string; within?: string; sort?: "total" | "mean" | "max" | "count"
}) {
  const events = store.completeEvents({ name: /^FunctionCall$/, within: opts.within }).filter((e) => e.args?.["data"]);
  const origin = opts.origin ? new RegExp(opts.origin, "i") : null;
  const byFunc = new Map<string, { name: string; url: string; line: number; count: number; totalMs: number; maxMs: number }>();
  for (const event of events) {
    const data = event.args!["data"] as Record<string, unknown>;
    const url = String(data["url"] ?? store.eventUrl(event) ?? "");
    if (origin && !origin.test(url)) continue;
    const name = String(data["functionName"] ?? "(anonymous)");
    const line = Number(data["lineNumber"] ?? -1);
    const key = `${url}:${name}:${line}`;
    const entry = byFunc.get(key) ?? { name, url, line, count: 0, totalMs: 0, maxMs: 0 };
    const ms = event.dur! / 1000;
    entry.count++; entry.totalMs += ms; entry.maxMs = Math.max(entry.maxMs, ms);
    byFunc.set(key, entry);
  }
  const sort = opts.sort ?? "total";
  const entries = [...byFunc.values()].sort((a, b) => {
    const value = (e: typeof a) => sort === "mean" ? e.totalMs / e.count : sort === "max" ? e.maxMs : sort === "count" ? e.count : e.totalMs;
    return value(b) - value(a);
  });
  return entries;
}

export function functions(store: TraceStore, opts: Parameters<typeof functionRows>[1]): string {
  const entries = functionRows(store,opts);
  if (!entries.length) return "No matching FunctionCall events.";
  return [`${entries.length} distinct functions\n`,
    table(["Function", "Calls", "Total", "Mean", "Max", "Source"],
      entries.slice(0, opts.limit).map((e) => [e.name, String(e.count), fmtMs(e.totalMs),
        fmtMs(e.totalMs / e.count), fmtMs(e.maxMs), source(e)]),
      ["l", "r", "r", "r", "r", "l"]),
  ].join("\n");
}
