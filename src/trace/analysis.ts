import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { resolveMainThread, stats } from "./format.ts";
import { occupiedUs } from "./commands/gc.ts";
import { TraceStore } from "./trace-store.ts";
import type { TraceEvent } from "./types.ts";

export function remapProfile(
  store: TraceStore,
  generatedUrl: string,
  mapPath: string,
) {
  const map = new SourceMap(JSON.parse(readFileSync(mapPath, "utf8")));
  for (const nodes of store.profileNodes.values()) {
    for (const node of nodes.values()) {
      const frame = node.callFrame;
      if (frame.url !== generatedUrl) continue;
      const original = map.findEntry(frame.lineNumber, frame.columnNumber);
      if (
        "originalSource" in original &&
        typeof original.originalSource === "string"
      ) {
        node.callFrame = {
          ...frame,
          url: original.originalSource,
          lineNumber: original.originalLine,
          columnNumber: original.originalColumn,
          functionName:
            ("name" in original &&
              typeof original.name === "string" &&
              original.name) ||
            frame.functionName,
        };
      }
    }
  }
}

/** Subtract the union of directly nested complete spans on the same thread. */
export function selfTimes(store: TraceStore, selected: TraceEvent[]) {
  const rows = new Map<
    string,
    { name: string; count: number; selfMs: number; totalMs: number }
  >();
  for (const e of selected) {
    const name = e.name ?? "(anonymous)";
    const row = rows.get(name) ?? { name, count: 0, selfMs: 0, totalMs: 0 };
    const children = store.children(e);
    row.count++;
    row.totalMs += e.dur! / 1000;
    row.selfMs += Math.max(0, e.dur! - occupiedUs(children)) / 1000;
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.selfMs - a.selfMs);
}

export function health(store: TraceStore, gaps: number[], thresholdMs = 50) {
  const main = resolveMainThread(store);
  const events = main
    ? store.completeEvents({ pid: main.pid, tid: main.tid })
    : [];
  const gc = events.filter((e) => e.name === "MinorGC" || e.name === "MajorGC");
  const tasks = events.filter(
    (e) => e.name === "RunTask" && e.dur! > thresholdMs * 1000,
  );
  const seconds = store.durationMs / 1000;
  return {
    durationMs: store.durationMs,
    frameGapMs: gaps.length ? stats(gaps) : null,
    rendererMain: main ? { pid: main.pid, tid: main.tid } : null,
    gcPauseMs: main ? occupiedUs(gc) / 1000 : null,
    longTasks: main ? tasks.length : null,
    longTasksPerSecond: main && seconds > 0 ? tasks.length / seconds : null,
    gcMsPerSecond: main && seconds > 0 ? occupiedUs(gc) / 1000 / seconds : null,
  };
}
