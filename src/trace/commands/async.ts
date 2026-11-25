import type { TraceStore } from "../trace-store.ts";
import type { TraceEvent } from "../types.ts";
import { fmtMs, table } from "../format.ts";

export interface CounterSeries {
  name: string;
  field: string;
  pid: number;
  category: string;
  id?: string;
  scope?: string;
  samples: number;
  min: number;
  max: number;
  last: number;
  lastUs: number;
}

function scopeOf(event: TraceEvent): string | undefined {
  return typeof (event as { scope?: unknown }).scope === "string"
    ? (event as { scope: string } & TraceEvent).scope : undefined;
}

export function counterSeries(events: readonly TraceEvent[], name?: string): CounterSeries[] {
  const filter = name ? new RegExp(name, "i") : null;
  const series = new Map<string, CounterSeries>();
  for (const event of events) {
    if (event.ph !== "C" || !event.name || !event.args || (filter && !filter.test(event.name))) continue;
    const category = event.cat ?? "";
    const id = event.id2?.local ?? event.id2?.global ?? event.id;
    const scope = scopeOf(event);
    for (const [field, value] of Object.entries(event.args)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const key = JSON.stringify([event.pid, category, event.name, field, scope, id, event.id2?.local !== undefined]);
      const entry = series.get(key);
      if (!entry) {
        series.set(key, { name: event.name, field, category, pid: event.pid, scope, id,
          samples: 1, min: value, max: value, last: value, lastUs: event.ts });
        continue;
      }
      entry.samples++;
      entry.min = Math.min(entry.min, value);
      entry.max = Math.max(entry.max, value);
      if (event.ts >= entry.lastUs) { entry.last = value; entry.lastUs = event.ts; }
    }
  }
  return [...series.values()];
}

export function counters(store: TraceStore, opts: { name?: string }): string {
  const series = counterSeries(store.events, opts.name);
  if (!series.length) return "No numeric counter series found.";
  return table(["Counter", "Field", "PID", "Category", "Scope", "ID", "Samples", "Min", "Max", "Last"],
    series.map(row => [row.name, row.field, String(row.pid), row.category, row.scope ?? "", String(row.id ?? ""),
      String(row.samples), String(row.min), String(row.max), String(row.last)]));
}

export interface TraceSlice {
  name: string;
  source: "sync" | "async" | "legacy-async";
  startUs: number;
  durationUs: number;
  pid: number;
  tid: number;
  endPid: number;
  endTid: number;
}

function sliceKey(event: TraceEvent, source: TraceSlice["source"]): string | undefined {
  if (source === "sync") return JSON.stringify(["sync", event.pid, event.tid]);
  const localId = event.id2?.local;
  // Legacy async id and id2.global are globally visible. id2.local is per process.
  const id = localId ?? event.id2?.global ?? event.id;
  if (id === undefined) return;
  return JSON.stringify([source, event.cat ?? "", scopeOf(event) ?? "", String(id),
    localId === undefined ? null : event.pid, source === "legacy-async" ? event.name : null]);
}

export function sliceData(events: readonly TraceEvent[], pattern: string, limit: number): TraceSlice[] {
  const filter = new RegExp(pattern, "i");
  const endpoints = events.filter(e => ["b", "e", "B", "E", "S", "F"].includes(e.ph))
    .sort((a, b) => a.ts - b.ts);
  const stacks = new Map<string, TraceEvent[]>();
  const result: TraceSlice[] = [];
  for (const event of endpoints) {
    const source = event.ph === "B" || event.ph === "E" ? "sync"
      : event.ph === "S" || event.ph === "F" ? "legacy-async" : "async";
    const key = sliceKey(event, source);
    if (key === undefined) continue;
    let stack = stacks.get(key);
    if (event.ph === "B" || event.ph === "b" || event.ph === "S") {
      if (!stack) { stack = []; stacks.set(key, stack); }
      stack.push(event);
      continue;
    }
    const begin = stack?.at(-1);
    if (!begin || !stack) continue;
    if (source === "async" && event.name && event.name !== begin.name) continue;
    stack.pop();
    if (!stack.length) stacks.delete(key);
    if (!begin.name || !filter.test(begin.name)) continue;
    result.push({ name: begin.name, source, startUs: begin.ts, durationUs: event.ts - begin.ts,
      pid: begin.pid, tid: begin.tid, endPid: event.pid, endTid: event.tid });
  }
  result.sort((a, b) => b.durationUs - a.durationUs || a.startUs - b.startUs);
  return result.slice(0, limit);
}

export function slices(store: TraceStore, opts: { pattern: string; limit: number }): string {
  if (!opts.pattern) return "Provide a pattern.";
  const rows = sliceData(store.events, opts.pattern, opts.limit);
  if (!rows.length) return `No slices matching "${opts.pattern}".`;
  const threadNames = new Map(store.threads.map(t => [`${t.pid}:${t.tid}`, t.threadName]));
  const label = (pid: number, tid: number) => `${pid}:${tid} ${threadNames.get(`${pid}:${tid}`) ?? ""}`.trimEnd();
  return table(["Name", "Duration", "Start thread", "End thread"], rows.map(row => [
    row.name, fmtMs(row.durationUs / 1000), label(row.pid, row.tid), label(row.endPid, row.endTid),
  ]), ["l", "r", "l", "l"]);
}
