import { TraceStore } from "../trace-store.ts";
import { us2ms, fmtMs, padR, resolveMainThread } from "../format.ts";

export function longTasks(
  store: TraceStore,
  opts: { thresholdMs: number }
): string {
  const main = resolveMainThread(store);
  if (!main) return "No renderer main thread found.";

  const tasks = store.events
    .filter(
      (e) =>
        e.pid === main.pid &&
        e.tid === main.tid &&
        e.name === "RunTask" &&
        e.ph === "X" &&
        e.dur !== undefined &&
        us2ms(e.dur) > opts.thresholdMs
    )
    .sort((a, b) => b.dur! - a.dur!);

  if (tasks.length === 0)
    return `No main-thread tasks above ${opts.thresholdMs}ms.`;

  const lines: string[] = [];
  lines.push(
    `${tasks.length} long tasks (>${opts.thresholdMs}ms) on main thread:\n`
  );

  for (const task of tasks.slice(0, 15)) {
    const taskStart = task.ts;
    const taskEnd = task.ts + task.dur!;
    lines.push(
      `── ${fmtMs(us2ms(task.dur!))} at offset ${fmtMs(us2ms(task.ts - store.minTs))} ──`
    );

    const children = store.events.filter(
      (e) =>
        e.pid === main.pid &&
        e.tid === main.tid &&
        e.ph === "X" &&
        e.dur !== undefined &&
        e.ts >= taskStart &&
        e.ts + e.dur! <= taskEnd &&
        e !== task
    );

    const byName = new Map<string, number>();
    for (const c of children) {
      if (c.name)
        byName.set(c.name, (byName.get(c.name) ?? 0) + us2ms(c.dur!));
    }
    const sorted = [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [name, dur] of sorted) {
      lines.push(`  ${padR(name, 40)} ${fmtMs(dur)}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}
