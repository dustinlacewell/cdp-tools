import { TraceStore } from "../trace-store.ts";
import {
  us2ms,
  fmtMs,
  stats,
  table,
  filterByThread,
  topByDuration,
} from "../format.ts";

export function names(
  store: TraceStore,
  opts: { cat?: string; thread?: string; limit: number; origin?: string; within?: string }
): string {
  let events = store.completeEvents({ origin: opts.origin, within: opts.within });
  if (opts.cat) events = events.filter((e) => e.cat?.includes(opts.cat!));
  if (opts.thread) events = filterByThread(events, store, opts.thread);

  const byName = new Map<string, { count: number; totalDurUs: number }>();
  for (const e of events) {
    if (!e.name) continue;
    const entry = byName.get(e.name) ?? { count: 0, totalDurUs: 0 };
    entry.count++;
    if (e.dur) entry.totalDurUs += e.dur;
    byName.set(e.name, entry);
  }

  const sorted = [...byName.entries()].sort((a, b) => b[1].count - a[1].count);
  return table(
    ["Name", "Count", "Total Dur"],
    sorted.slice(0, opts.limit).map(([name, { count, totalDurUs }]) => [
      name,
      String(count),
      totalDurUs > 0 ? fmtMs(us2ms(totalDurUs)) : "—",
    ]),
    ["l", "r", "r"]
  );
}

export function top(
  store: TraceStore,
  opts: { n: number; thread?: string; cat?: string; origin?: string; within?: string }
): string {
  let events = store.completeEvents({ origin: opts.origin, within: opts.within });
  if (opts.thread) events = filterByThread(events, store, opts.thread);
  if (opts.cat) events = events.filter((e) => e.cat?.includes(opts.cat!));

  const topEvents = topByDuration(events, opts.n);
  return table(
    ["#", "Name", "Total", "Count", "Mean", "Max"],
    topEvents.map(({ name, total, count, mean, max }, i) => [
      String(i + 1),
      name,
      fmtMs(total),
      String(count),
      fmtMs(mean),
      fmtMs(max),
    ]),
    ["r", "l", "r", "r", "r", "r"]
  );
}

export function summarize(store: TraceStore, name: string, within?: string): string {
  const events = store.completeEvents({ name, within });
  if (events.length === 0)
    return `No complete events with name "${name}". Try 'search' to find similar names.`;

  const durMs = events.map((e) => us2ms(e.dur!));
  const s = stats(durMs);

  const lines: string[] = [];
  lines.push(`Event: ${name}`);
  lines.push(`Count:  ${s.count}`);
  lines.push(`Total:  ${fmtMs(s.total)}`);
  lines.push(`Mean:   ${fmtMs(s.mean)}`);
  lines.push(`Median: ${fmtMs(s.median)}`);
  lines.push(`P95:    ${fmtMs(s.p95)}`);
  lines.push(`P99:    ${fmtMs(s.p99)}`);
  lines.push(`Max:    ${fmtMs(s.max)}`);
  lines.push(`Min:    ${fmtMs(s.min)}`);

  const threadCounts = new Map<string, number>();
  for (const e of events) {
    const t = store.threadOf(e);
    const label = `${t.processName}/${t.threadName}`;
    threadCounts.set(label, (threadCounts.get(label) ?? 0) + 1);
  }
  lines.push(`\nThreads:`);
  for (const [label, count] of [...threadCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`  ${label}: ${count}`);
  }

  return lines.join("\n");
}

export function search(
  store: TraceStore,
  opts: { pattern: string; limit: number; thread?: string; origin?: string; within?: string }
): string {
  if (!opts.pattern) return "Provide a search pattern.";
  let events = store.completeEvents({
    name: new RegExp(opts.pattern, "i"),
    origin: opts.origin,
    within: opts.within,
  });
  if (opts.thread) events = filterByThread(events, store, opts.thread);
  events.sort((a, b) => b.dur! - a.dur!);

  if (events.length === 0) return `No events matching "${opts.pattern}".`;

  const showing = events.slice(0, opts.limit);
  const lines: string[] = [];
  lines.push(`${events.length} matches (showing ${showing.length}):\n`);
  lines.push(
    table(
      ["Name", "Duration", "Thread", "Offset"],
      showing.map((e) => {
        const t = store.threadOf(e);
        return [
          e.name ?? "?",
          fmtMs(us2ms(e.dur!)),
          t.threadName,
          fmtMs(us2ms(e.ts - store.minTs)),
        ];
      }),
      ["l", "r", "l", "r"]
    )
  );
  return lines.join("\n");
}

export function slowest(
  store: TraceStore,
  opts: { pattern: string; limit: number; origin?: string; within?: string }
): string {
  if (!opts.pattern) return "Provide a name pattern.";
  const events = store
    .completeEvents({
      name: new RegExp(opts.pattern, "i"),
      origin: opts.origin,
      within: opts.within,
    })
    .sort((a, b) => b.dur! - a.dur!)
    .slice(0, opts.limit);

  if (events.length === 0) return `No events matching "${opts.pattern}".`;

  return table(
    ["Name", "Duration", "Thread", "Offset", "Args (truncated)"],
    events.map((e) => {
      const t = store.threadOf(e);
      const argsStr = e.args ? JSON.stringify(e.args).slice(0, 80) : "";
      return [
        e.name ?? "?",
        fmtMs(us2ms(e.dur!)),
        t.threadName,
        fmtMs(us2ms(e.ts - store.minTs)),
        argsStr,
      ];
    }),
    ["l", "r", "l", "r", "l"]
  );
}
