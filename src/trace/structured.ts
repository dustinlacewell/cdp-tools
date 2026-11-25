import { aggregateChildren } from "./commands/group.ts";
import { stats, filterByThread, resolveMainThread } from "./format.ts";
import { sourceUrls } from "./commands/sources.ts";
import { counterSeries, sliceData } from "./commands/async.ts";
import { functionRows, profileData } from "./commands/profile.ts";
import { occupiedUs } from "./commands/gc.ts";
import { decodePresentation } from "./presentation.ts";
import type { TraceStore } from "./trace-store.ts";
import type { TraceEvent } from "./types.ts";

export function structured(
  store: TraceStore,
  command: string,
  pattern: string | undefined,
  options: Record<string, string>,
  limit: number,
) {
  const row = (e: TraceEvent) => ({
    name: e.name,
    pid: e.pid,
    tid: e.tid,
    startUs: e.ts,
    durationMs: (e.dur ?? 0) / 1000,
    source: store.eventUrl(e),
  });
  const byDuration = (a: TraceEvent, b: TraceEvent) => b.dur! - a.dur!;
  const selected = (name?: string | RegExp) =>
    store.completeEvents({
      name,
      within: options.within,
      origin: options.origin,
      cat: options.cat,
    });
  switch (command) {
    case "categories": {
      const counts = new Map<string, number>();
      for (const e of store.events)
        if (e.cat) counts.set(e.cat, (counts.get(e.cat) ?? 0) + 1);
      return [...counts]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
    }
    case "sources":
      return sourceUrls(store);
    case "scripts":
      return store
        .scriptsFor(options.pid === undefined ? undefined : Number(options.pid))
        .filter(
          (s) => !options.origin || new RegExp(options.origin, "i").test(s.url),
        );
    case "calls": {
      const re = new RegExp(options.source ?? options.origin ?? "", "i");
      return store
        .completeEvents({
          name: /^(FunctionCall|EvaluateScript)$/,
          within: options.within,
        })
        .filter((e) => re.test(store.eventUrl(e) ?? ""))
        .sort(byDuration)
        .slice(0, limit)
        .map(row);
    }
    case "functions":
      return functionRows(store, {
        ...options,
        limit,
        sort: options.sort as "total" | undefined,
      }).slice(0, limit);
    case "counters":
      return counterSeries(store.events, options.name);
    case "slices":
      return sliceData(store.events, pattern!, limit);
    case "search":
    case "slowest":
    case "names": {
      let events = selected(pattern);
      if (options.thread)
        events = filterByThread(events, store, options.thread);
      if (command !== "names")
        return events.sort(byDuration).slice(0, limit).map(row);
      const groups = new Map<
        string,
        { name: string; count: number; totalMs: number }
      >();
      for (const e of events) {
        if (!e.name) continue;
        const group = groups.get(e.name) ?? {
          name: e.name,
          count: 0,
          totalMs: 0,
        };
        group.count++;
        group.totalMs += e.dur! / 1000;
        groups.set(e.name, group);
      }
      return [...groups.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    }
    case "frames":
    case "frame": {
      const timeline = decodePresentation(store.events, {
        hz: options.hz ? Number(options.hz) : undefined,
      });
      const frames = timeline.frames;
      if (command === "frames")
        return {
          source: timeline.source,
          streams: timeline.streams,
          count: frames.length,
          frames: frames.slice(0, limit),
        };
      if (pattern && pattern !== "worst") {
        const target = frames[Number(pattern)];
        if (!target) throw new Error("Frame index out of range.");
        return target;
      }
      return (
        [...frames].sort((a, b) => (b.gapMs ?? -1) - (a.gapMs ?? -1))[0] ?? null
      );
    }
    case "gc":
    case "long-tasks": {
      const main = resolveMainThread(store);
      if (!main) return { rendererMain: null, entries: [] };
      const onMain = store.completeEvents({ pid: main.pid, tid: main.tid });
      if (command === "long-tasks")
        return onMain
          .filter(
            (e) =>
              e.name === "RunTask" &&
              e.dur! > Number(options.threshold ?? 50) * 1000,
          )
          .sort(byDuration)
          .slice(0, limit)
          .map(row);
      const pauses = onMain.filter(
        (e) => e.name === "MinorGC" || e.name === "MajorGC",
      );
      return {
        rendererMain: { pid: main.pid, tid: main.tid },
        pauseCount: pauses.length,
        pauseMs: occupiedUs(pauses) / 1000,
        longestPauses: pauses.sort(byDuration).slice(0, limit).map(row),
      };
    }
    case "tree": {
      const roots = selected(pattern).sort(byDuration).slice(0, limit);
      function branch(e: TraceEvent, depth: number): object {
        return {
          ...row(e),
          children: depth
            ? store
                .directChildren(e)
                .sort(byDuration)
                .slice(0, 8)
                .map((c) => branch(c, depth - 1))
            : [],
        };
      }
      return roots.map((e) => branch(e, 4));
    }
    case "group": {
      let parents = store.completeEvents({
        name: pattern,
        within: options.within,
      });
      const main = resolveMainThread(store);
      const onMain = parents.filter(
        (e) => e.pid === main?.pid && e.tid === main.tid,
      );
      if (onMain.length) parents = onMain;
      const samples = store.filteredProfileSamples({ within: parents });
      const durations = parents.map((e) => e.dur! / 1000);
      return {
        pattern,
        durationMs: stats(durations),
        overBudget: options.budget
          ? durations.filter((ms) => ms > Number(options.budget)).length
          : null,
        children: aggregateChildren(
          store,
          parents,
          Number(options.depth ?? 1),
        ).slice(0, limit),
        sampledFunctions: profileData(store, options, samples).entries.slice(
          0,
          limit,
        ),
      };
    }
    default:
      throw new Error("Unknown structured report " + command);
  }
}
