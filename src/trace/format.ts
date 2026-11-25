import type { TraceEvent } from "./types.ts";
import { TraceStore } from "./trace-store.ts";

export function us2ms(us: number): number {
  return us / 1000;
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(2)}ms`;
  return `${(ms * 1000).toFixed(0)}µs`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

export function stats(values: number[]) {
  if (values.length === 0)
    return { count: 0, total: 0, mean: 0, median: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    total,
    mean: total / sorted.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1]!,
    min: sorted[0]!,
  };
}

export function padR(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function table(
  headers: string[],
  rows: string[][],
  align: ("l" | "r")[] = []
): string {
  const widths = headers.map((h, i) =>
    rows.reduce((width, row) => Math.max(width, (row[i] ?? "").length), h.length)
  );
  const pad = (s: string, i: number) =>
    (align[i] ?? "l") === "r" ? padL(s, widths[i]!) : padR(s, widths[i]!);

  const lines: string[] = [];
  lines.push(headers.map((h, i) => pad(h, i)).join("  "));
  lines.push(widths.map((w) => "─".repeat(w)).join("──"));
  for (const row of rows) {
    lines.push(row.map((c, i) => pad(c, i)).join("  "));
  }
  return lines.join("\n");
}

/** Render an ASCII histogram from values in ms */
export function histogram(
  values: number[],
  opts: { budgetMs?: number } = {}
): string {
  if (values.length === 0) return "  (no data)";

  const sorted = [...values].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1]!;

  // Build adaptive buckets based on data range
  const buckets: Array<{ label: string; lo: number; hi: number; count: number }> = [];
  if (max <= 2) {
    buckets.push({ label: "<0.5ms", lo: 0, hi: 0.5, count: 0 });
    buckets.push({ label: "0.5-1ms", lo: 0.5, hi: 1, count: 0 });
    buckets.push({ label: "1-2ms", lo: 1, hi: 2, count: 0 });
    buckets.push({ label: ">2ms", lo: 2, hi: Infinity, count: 0 });
  } else if (max <= 10) {
    buckets.push({ label: "<1ms", lo: 0, hi: 1, count: 0 });
    buckets.push({ label: "1-2ms", lo: 1, hi: 2, count: 0 });
    buckets.push({ label: "2-4ms", lo: 2, hi: 4, count: 0 });
    buckets.push({ label: "4-8ms", lo: 4, hi: 8, count: 0 });
    buckets.push({ label: ">8ms", lo: 8, hi: Infinity, count: 0 });
  } else if (max <= 50) {
    buckets.push({ label: "<2ms", lo: 0, hi: 2, count: 0 });
    buckets.push({ label: "2-5ms", lo: 2, hi: 5, count: 0 });
    buckets.push({ label: "5-10ms", lo: 5, hi: 10, count: 0 });
    buckets.push({ label: "10-20ms", lo: 10, hi: 20, count: 0 });
    buckets.push({ label: "20-50ms", lo: 20, hi: 50, count: 0 });
    buckets.push({ label: ">50ms", lo: 50, hi: Infinity, count: 0 });
  } else {
    buckets.push({ label: "<5ms", lo: 0, hi: 5, count: 0 });
    buckets.push({ label: "5-16ms", lo: 5, hi: 16, count: 0 });
    buckets.push({ label: "16-33ms", lo: 16, hi: 33, count: 0 });
    buckets.push({ label: "33-50ms", lo: 33, hi: 50, count: 0 });
    buckets.push({ label: "50-100ms", lo: 50, hi: 100, count: 0 });
    buckets.push({ label: ">100ms", lo: 100, hi: Infinity, count: 0 });
  }

  for (const v of values) {
    for (const b of buckets) {
      if (v >= b.lo && v < b.hi) {
        b.count++;
        break;
      }
    }
  }

  const maxCount = Math.max(...buckets.map((b) => b.count));
  const maxBarWidth = 30;
  const labelWidth = Math.max(...buckets.map((b) => b.label.length));
  const countWidth = String(maxCount).length;

  const lines: string[] = [];
  for (const b of buckets) {
    if (b.count === 0 && b.lo > max) continue;
    const barLen = maxCount > 0 ? Math.round((b.count / maxCount) * maxBarWidth) : 0;
    const bar = "█".repeat(barLen);
    const pct = ((b.count / values.length) * 100).toFixed(1);
    lines.push(
      `  ${padR(b.label, labelWidth)}  ${bar}${padL("", maxBarWidth - barLen)}  ${padL(String(b.count), countWidth)}  (${padL(pct, 5)}%)`
    );
  }

  if (opts.budgetMs !== undefined) {
    const overBudget = values.filter((v) => v > opts.budgetMs!).length;
    const withinBudget = values.length - overBudget;
    lines.push("");
    lines.push(
      `  Budget: ${fmtMs(opts.budgetMs)} — ${withinBudget}/${values.length} within (${((withinBudget / values.length) * 100).toFixed(1)}%)`
    );
  }

  return lines.join("\n");
}

export function resolveMainThread(
  store: TraceStore
): { pid: number; tid: number } | null {
  const candidates = store.threads.filter(
    (t) => t.threadName === "CrRendererMain"
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.eventCount - a.eventCount)[0]!;
}

export function filterByThread(
  events: TraceEvent[],
  store: TraceStore,
  threadName: string
): TraceEvent[] {
  const matching = store.threads.filter((t) =>
    t.threadName.toLowerCase().includes(threadName.toLowerCase())
  );
  if (matching.length === 0) return [];
  const keys = new Set(matching.map((t) => `${t.pid}:${t.tid}`));
  return events.filter((e) => keys.has(`${e.pid}:${e.tid}`));
}

export function topByDuration(
  events: TraceEvent[],
  n: number
): Array<{ name: string; total: number; count: number; mean: number; max: number }> {
  const byName = new Map<string, number[]>();
  for (const e of events) {
    if (!e.name || !e.dur) continue;
    let arr = byName.get(e.name);
    if (!arr) {
      arr = [];
      byName.set(e.name, arr);
    }
    arr.push(us2ms(e.dur));
  }

  const results: Array<{
    name: string;
    total: number;
    count: number;
    mean: number;
    max: number;
  }> = [];
  for (const [name, durs] of byName) {
    let total = 0;
    let max = 0;
    for (const d of durs) {
      total += d;
      if (d > max) max = d;
    }
    results.push({
      name,
      total,
      count: durs.length,
      mean: total / durs.length,
      max,
    });
  }
  return results.sort((a, b) => b.total - a.total).slice(0, n);
}
