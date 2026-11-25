import { TraceStore } from "../trace-store.ts";
import type { TraceEvent } from "../types.ts";
import { us2ms, fmtMs, table, resolveMainThread } from "../format.ts";

/** Union durations per thread: nested GC phases must not be added twice. */
export function occupiedUs(events: TraceEvent[]): number {
  const byThread = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const key = `${event.pid}:${event.tid}`;
    const list = byThread.get(key) ?? [];
    list.push(event);
    byThread.set(key, list);
  }
  let total = 0;
  for (const list of byThread.values()) {
    list.sort((a, b) => a.ts - b.ts);
    let start = -1;
    let end = -1;
    for (const event of list) {
      const finish = event.ts + event.dur!;
      if (event.ts > end) {
        if (end >= start) total += end - start;
        start = event.ts;
        end = finish;
      } else end = Math.max(end, finish);
    }
    if (end >= start) total += end - start;
  }
  return total;
}

export function gc(store: TraceStore): string {
  const events = store.events.filter((e) => e.ph === "X" && e.dur !== undefined &&
    e.name !== undefined && (e.name.includes("GC") || e.name === "CppGC.ConcurrentMark" || e.name === "CppGC.ConcurrentSweep"));
  if (!events.length) return "No GC events found.";
  const main = resolveMainThread(store);
  const onMain = main ? events.filter((e) => e.pid === main.pid && e.tid === main.tid) : [];
  const pauses = onMain.filter((e) => e.name === "MinorGC" || e.name === "MajorGC");
  const background = events.filter((e) => e.name?.includes("BACKGROUND") ||
    e.name?.includes("Concurrent") || e.name?.includes("LowPriority"));
  const pauseMs = us2ms(occupiedUs(pauses));
  const backgroundMs = us2ms(occupiedUs(background));
  const byName = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const list = byName.get(event.name!) ?? [];
    list.push(event);
    byName.set(event.name!, list);
  }
  const rows = [...byName].map(([name, list]) => ({ name, count: list.length,
    ms: us2ms(occupiedUs(list)) })).sort((a, b) => b.ms - a.ms);
  return [
    `Main-thread GC pauses (MinorGC + MajorGC): ${fmtMs(pauseMs)} over ${pauses.length} events`,
    `Share of trace: ${(store.durationMs ? 100 * pauseMs / store.durationMs : 0).toFixed(2)}%`,
    `Background GC work (summed thread time): ${fmtMs(backgroundMs)}`,
    `GC events including nested phases: ${events.length}\n`,
    `The phase rows below overlap; do not sum them to estimate pause time.\n`,
    table(["Event", "Thread time", "Count", "Mean"],
      rows.map(({ name, count, ms }) => [name, fmtMs(ms), String(count), fmtMs(ms / count)]),
      ["l", "r", "r", "r"]),
  ].join("\n");
}
