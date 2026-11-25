import { TraceStore } from "../trace-store.ts";
import { fmtMs, table, us2ms, topByDuration } from "../format.ts";
import { profileData } from "./profile.ts";

/**
 * Compare two traces using the same analysis, show structured deltas.
 */
export function diff(
  storeA: TraceStore,
  storeB: TraceStore,
  opts: {
    subcommand: string;
    limit: number;
    origin?: string;
    within?: string;
    sort?: "total" | "mean" | "max" | "count";
    n?: number;
    pattern?: string;
    budget?: number;
    depth?: number;
  }
): string {
  switch (opts.subcommand) {
    case "profile":
      return diffProfile(storeA, storeB, opts);
    case "top":
      return diffTop(storeA, storeB, opts);
    case "group":
      return diffGroup(storeA, storeB, opts);
    default:
      return `Unsupported diff subcommand: "${opts.subcommand}". Supported: profile, top, group`;
  }
}

function diffProfile(
  storeA: TraceStore,
  storeB: TraceStore,
  opts: { limit: number; origin?: string; within?: string }
): string {
  const a = profileData(storeA, opts);
  const b = profileData(storeB, opts);

  if (a.entries.length === 0 && b.entries.length === 0) return "No profile data in either trace.";

  // Build lookup by function identity (name + source location)
  const key = (e: { name: string; url: string; line: number }) =>
    `${e.url}:${e.name}:${e.line}`;

  const aMap = new Map(a.entries.map((e) => [key(e), e]));
  const bMap = new Map(b.entries.map((e) => [key(e), e]));

  const allKeys = new Set([...aMap.keys(), ...bMap.keys()]);
  const rows: Array<{
    name: string;
    source: string;
    beforeMs: number;
    afterMs: number;
    deltaMs: number;
    deltaPct: number;
  }> = [];

  for (const k of allKeys) {
    const ea = aMap.get(k);
    const eb = bMap.get(k);
    const beforeMs = ea?.selfMs ?? 0;
    const afterMs = eb?.selfMs ?? 0;
    const deltaMs = afterMs - beforeMs;
    const deltaPct = beforeMs > 0 ? (deltaMs / beforeMs) * 100 : afterMs > 0 ? 100 : 0;
    const entry = ea ?? eb!;
    const short = entry.url ? entry.url.split("/").pop() ?? entry.url : "";
    const loc = entry.line > 0 ? `${short}:${entry.line}` : short;

    rows.push({ name: entry.name, source: loc, beforeMs, afterMs, deltaMs, deltaPct });
  }

  // Sort by absolute delta (biggest changes first)
  rows.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs));

  const totalBeforeMs = a.entries.reduce((s, e) => s + e.selfMs, 0);
  const totalAfterMs = b.entries.reduce((s, e) => s + e.selfMs, 0);
  const totalDelta = totalAfterMs - totalBeforeMs;

  const lines: string[] = [];
  lines.push(`Profile Diff: ${fmtMs(totalBeforeMs)} → ${fmtMs(totalAfterMs)} (${sign(totalDelta)}${fmtMs(Math.abs(totalDelta))})\n`);

  lines.push(
    table(
      ["Function", "Before", "After", "Delta", "Change", "Source"],
      rows.slice(0, opts.limit).map((r) => [
        r.name,
        fmtMs(r.beforeMs),
        fmtMs(r.afterMs),
        `${sign(r.deltaMs)}${fmtMs(Math.abs(r.deltaMs))}`,
        r.beforeMs > 0 ? `${sign(r.deltaPct)}${Math.abs(r.deltaPct).toFixed(1)}%` : "new",
        r.source,
      ]),
      ["l", "r", "r", "r", "r", "l"]
    )
  );

  return lines.join("\n");
}

function diffTop(
  storeA: TraceStore,
  storeB: TraceStore,
  opts: { n?: number; origin?: string; within?: string; limit: number }
): string {
  const n = opts.n ?? opts.limit;
  const eventsA = storeA.completeEvents({ origin: opts.origin, within: opts.within });
  const eventsB = storeB.completeEvents({ origin: opts.origin, within: opts.within });

  const topA = topByDuration(eventsA, Infinity);
  const topB = topByDuration(eventsB, Infinity);

  const aMap = new Map(topA.map((e) => [e.name, e]));
  const bMap = new Map(topB.map((e) => [e.name, e]));

  const allNames = new Set([...aMap.keys(), ...bMap.keys()]);
  const rows: Array<{
    name: string;
    beforeMs: number;
    afterMs: number;
    deltaMs: number;
    beforeCount: number;
    afterCount: number;
  }> = [];

  for (const name of allNames) {
    const ea = aMap.get(name);
    const eb = bMap.get(name);
    rows.push({
      name,
      beforeMs: ea?.total ?? 0,
      afterMs: eb?.total ?? 0,
      deltaMs: (eb?.total ?? 0) - (ea?.total ?? 0),
      beforeCount: ea?.count ?? 0,
      afterCount: eb?.count ?? 0,
    });
  }

  rows.sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs));

  const lines: string[] = [];
  lines.push(`Top Events Diff:\n`);
  lines.push(
    table(
      ["Name", "Before", "After", "Delta", "Count A", "Count B"],
      rows.slice(0, n).map((r) => [
        r.name,
        fmtMs(r.beforeMs),
        fmtMs(r.afterMs),
        `${sign(r.deltaMs)}${fmtMs(Math.abs(r.deltaMs))}`,
        String(r.beforeCount),
        String(r.afterCount),
      ]),
      ["l", "r", "r", "r", "r", "r"]
    )
  );

  return lines.join("\n");
}

function diffGroup(
  storeA: TraceStore,
  storeB: TraceStore,
  opts: { pattern?: string; origin?: string; within?: string; limit: number }
): string {
  if (!opts.pattern) return "Provide a pattern for group diff.";
  const re = new RegExp(opts.pattern, "i");

  const parentsA = storeA.completeEvents({ name: re, within: opts.within }).sort((a, b) => a.ts - b.ts);
  const parentsB = storeB.completeEvents({ name: re, within: opts.within }).sort((a, b) => a.ts - b.ts);

  if (parentsA.length === 0 && parentsB.length === 0)
    return `No events matching "${opts.pattern}" in either trace.`;

  const dursA = parentsA.map((e) => us2ms(e.dur!));
  const dursB = parentsB.map((e) => us2ms(e.dur!));

  const statsA = dursA.length > 0 ? statsOf(dursA) : null;
  const statsB = dursB.length > 0 ? statsOf(dursB) : null;

  const lines: string[] = [];
  lines.push(`Group Diff: ${opts.pattern}\n`);
  lines.push(
    table(
      ["Metric", "Before", "After", "Delta"],
      [
        diffRow("Count", statsA?.count ?? 0, statsB?.count ?? 0, false),
        diffRow("Mean", statsA?.mean ?? 0, statsB?.mean ?? 0),
        diffRow("Median", statsA?.median ?? 0, statsB?.median ?? 0),
        diffRow("P95", statsA?.p95 ?? 0, statsB?.p95 ?? 0),
        diffRow("P99", statsA?.p99 ?? 0, statsB?.p99 ?? 0),
        diffRow("Max", statsA?.max ?? 0, statsB?.max ?? 0),
      ],
      ["l", "r", "r", "r"]
    )
  );

  return lines.join("\n");
}

function statsOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  const pct = (p: number) => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]!;
  return {
    count: sorted.length,
    total,
    mean: total / sorted.length,
    median: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    max: sorted[sorted.length - 1]!,
    min: sorted[0]!,
  };
}

function diffRow(label: string, before: number, after: number, isMs = true): string[] {
  const delta = after - before;
  const fmt = isMs ? fmtMs : String;
  return [
    label,
    fmt(before),
    fmt(after),
    `${sign(delta)}${isMs ? fmtMs(Math.abs(delta)) : String(Math.abs(delta))}`,
  ];
}

function sign(n: number): string {
  return n >= 0 ? "+" : "-";
}
