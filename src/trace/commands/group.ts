import { TraceStore } from "../trace-store.ts";
import type { TraceEvent, TimeRange } from "../types.ts";
import { us2ms, fmtMs, stats, table, histogram, resolveMainThread } from "../format.ts";
import { profileData } from "./profile.ts";

/**
 * Analyze a recurring event as a statistical population.
 * Shows: duration stats, histogram, budget analysis, trace-event children,
 * and CPU profile breakdown (the functions actually consuming time).
 */
export function group(
  store: TraceStore,
  opts: {
    pattern: string;
    budget?: number;
    depth: number;
    limit: number;
    origin?: string;
    within?: string;
  }
): string {
  if (!opts.pattern) return "Provide an event name pattern.";
  const re = new RegExp(opts.pattern, "i");

  const main = resolveMainThread(store);
  let parents = store.completeEvents({ name: re, within: opts.within });
  // Prefer main thread if events exist there
  if (main && parents.some((e) => e.pid === main.pid && e.tid === main.tid)) {
    parents = parents.filter((e) => e.pid === main.pid && e.tid === main.tid);
  }
  parents.sort((a, b) => a.ts - b.ts);

  if (parents.length === 0) return `No events matching "${opts.pattern}".`;

  const durationsMs = parents.map((e) => us2ms(e.dur!));
  const s = stats(durationsMs);

  const lines: string[] = [];
  lines.push(`${opts.pattern}: ${parents.length} occurrences\n`);

  // Duration stats
  lines.push(`Duration:`);
  lines.push(`  Mean:   ${fmtMs(s.mean)}`);
  lines.push(`  Median: ${fmtMs(s.median)}`);
  lines.push(`  P95:    ${fmtMs(s.p95)}`);
  lines.push(`  P99:    ${fmtMs(s.p99)}`);
  lines.push(`  Max:    ${fmtMs(s.max)}`);
  lines.push(`  Min:    ${fmtMs(s.min)}`);

  // Histogram
  lines.push(`\nDistribution:`);
  lines.push(histogram(durationsMs, { budgetMs: opts.budget }));

  // CPU profile breakdown — what functions actually consume time inside these events
  const { entries: profileEntries, matchedSamples } = profileData(store, {
    origin: opts.origin,
  }, store.filteredProfileSamples({within:parents}));

  if (profileEntries.length > 0) {
    const profileTotal = profileEntries.reduce((sum, e) => sum + e.selfMs, 0);
    lines.push(`\nCPU profile (sampled self-time within ${opts.pattern}${opts.origin ? `, origin: ${opts.origin}` : ""}):`);
    lines.push(
      table(
        ["Function", "Self Time", "Self %", "Per occurrence", "Source"],
        profileEntries.slice(0, opts.limit).map((f) => {
          const pct = profileTotal > 0 ? ((f.selfMs / profileTotal) * 100).toFixed(1) : "0.0";
          const perOccurrence = f.selfMs / parents.length;
          const short = f.url ? f.url.split("/").pop() ?? f.url : "";
          const loc = f.line > 0 ? `${short}:${f.line}` : short;
          return [f.name, fmtMs(f.selfMs), `${pct}%`, fmtMs(perOccurrence), loc];
        }),
        ["l", "r", "r", "r", "l"]
      )
    );
    lines.push(`\n  Total sampled: ${fmtMs(profileTotal)}, ${matchedSamples} samples`);
  }

  // Trace-event child breakdown (Chrome instrumentation events)
  if (opts.depth > 0) {
    const childAgg = aggregateChildren(store, parents, opts.depth);

    if (childAgg.length > 0) {
      lines.push(`\nTrace event children (depth ${opts.depth}):`);
      lines.push(
        table(
          ["Name", "Mean", "Total", "Rate", "% of parent"],
          childAgg.slice(0, opts.limit).map((c) => [
            c.indent + c.name,
            fmtMs(c.meanMs),
            fmtMs(c.totalMs),
            `${((c.occurrences / parents.length) * 100).toFixed(0)}%`,
            `${((c.totalMs / s.total) * 100).toFixed(1)}%`,
          ]),
          ["l", "r", "r", "r", "r"]
        )
      );
    }
  }

  return lines.join("\n");
}

interface ChildAggEntry {
  name: string;
  indent: string;
  totalMs: number;
  meanMs: number;
  occurrences: number;
  depth: number;
}

export function aggregateChildren(
  store: TraceStore,
  parents: TraceEvent[],
  maxDepth: number
): ChildAggEntry[] {
  const result: ChildAggEntry[] = [];
  if (maxDepth > 0) aggregateAtDepth(store, parents, 1, maxDepth, result);
  return result;
}

function aggregateAtDepth(
  store: TraceStore,
  parents: TraceEvent[],
  currentDepth: number,
  maxDepth: number,
  result: ChildAggEntry[]
): void {
  const byName = new Map<
    string,
    { totalUs: number; occurrences: number; instances: TraceEvent[] }
  >();

  for (const parent of parents) {
    const directChildren = store.directChildren(parent);
    const seenNames = new Set<string>();

    for (const child of directChildren) {
      const name = child.name ?? "(unknown)";
      const entry = byName.get(name) ?? { totalUs: 0, occurrences: 0, instances: [] };
      entry.totalUs += child.dur!;
      entry.instances.push(child);
      if (!seenNames.has(name)) {
        seenNames.add(name);
        entry.occurrences++;
      }
      byName.set(name, entry);
    }
  }

  const sorted = [...byName.entries()]
    .map(([name, data]) => ({
      name,
      totalMs: us2ms(data.totalUs),
      meanMs: us2ms(data.totalUs) / data.occurrences,
      occurrences: data.occurrences,
      instances: data.instances,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const indent = "  ".repeat(currentDepth - 1);

  for (const entry of sorted) {
    result.push({
      name: entry.name,
      indent,
      totalMs: entry.totalMs,
      meanMs: entry.meanMs,
      occurrences: entry.occurrences,
      depth: currentDepth,
    });

    if (currentDepth < maxDepth && entry.instances.length > 0) {
      aggregateAtDepth(store, entry.instances, currentDepth + 1, maxDepth, result);
    }
  }
}

