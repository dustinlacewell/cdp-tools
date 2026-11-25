import { TraceStore } from "../trace-store.ts";
import { fmtMs, padR, padL, topByDuration } from "../format.ts";

export function overview(store: TraceStore, origin?: string, within?: string): string {
  const lines: string[] = [];
  lines.push(`Duration:   ${fmtMs(store.durationMs)}`);
  lines.push(`Events:     ${store.events.length}`);
  if (store.metadata.startTime)
    lines.push(`Start:      ${store.metadata.startTime}`);

  const complete = store.completeEvents({ origin, within });
  lines.push(`Complete:   ${complete.length} (ph=X with dur)`);

  const byPhase = new Map<string, number>();
  for (const e of store.events) {
    byPhase.set(e.ph, (byPhase.get(e.ph) ?? 0) + 1);
  }
  lines.push(
    `Phases:     ${[...byPhase.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ph, n]) => `${ph}=${n}`)
      .join(", ")}`
  );

  const ts = store.threads.slice(0, 10);
  lines.push(`\nTop threads:`);
  for (const t of ts) {
    lines.push(
      `  ${padR(t.processName + "/" + t.threadName, 50)} ${t.eventCount} events`
    );
  }

  lines.push(`\nTop 10 by total duration${origin ? ` (origin: ${origin})` : ""}:`);
  const topEvents = topByDuration(complete, 10);
  for (const [i, { name, total, count }] of topEvents.entries()) {
    lines.push(
      `  ${padL(String(i + 1), 2)}. ${padR(name, 45)} ${padL(fmtMs(total), 10)} (${count}x)`
    );
  }

  return lines.join("\n");
}

export function threads(store: TraceStore): string {
  return (
    ["Process", "Thread", "PID", "TID", "Events"]
      .map((h, i) => padR(h, [20, 30, 8, 8, 8][i]!))
      .join("  ") +
    "\n" +
    [20, 30, 8, 8, 8].map((w) => "─".repeat(w)).join("──") +
    "\n" +
    store.threads
      .map(
        (t) =>
          padR(t.processName, 20) +
          "  " +
          padR(t.threadName, 30) +
          "  " +
          padL(String(t.pid), 8) +
          "  " +
          padL(String(t.tid), 8) +
          "  " +
          padL(String(t.eventCount), 8)
      )
      .join("\n")
  );
}

export function categories(store: TraceStore): string {
  const byCat = new Map<string, number>();
  for (const e of store.events) {
    if (e.cat) byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
  }
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const lines: string[] = [];
  for (const [cat, n] of sorted) {
    lines.push(`${padR(cat, 70)}  ${padL(String(n), 6)}`);
  }
  return lines.join("\n");
}
