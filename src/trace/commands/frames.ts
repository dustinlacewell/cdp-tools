import { TraceStore } from "../trace-store.ts";
import type { TraceEvent } from "../types.ts";
import { us2ms, fmtMs, stats, table, resolveMainThread } from "../format.ts";
import { decodePresentation, type PresentationFrame } from "../presentation.ts";

function isDisplaySignal(frame: PresentationFrame): boolean {
  return frame.source !== "AnimationService" && frame.source !== "RAF";
}

function displaySummary(frames: PresentationFrame[]): string {
  const timing = stats(frames.flatMap(f => f.gapMs === null ? [] : [f.gapMs]));
  const ranked = frames.filter(f => f.gapMs !== null).sort((a, b) => b.gapMs! - a.gapMs!);
  const presented = frames.filter(f => f.status === "presented").length;
  const partial = frames.filter(f => f.status === "partial").length;
  const lines = [`Frame outcomes: ${presented} presented, ${partial} partial, ${frames.length - presented - partial} dropped`];
  if (timing.count) {
    lines.push(`Presentation gaps: ${timing.count} intervals, median ${fmtMs(timing.median)}, p95 ${fmtMs(timing.p95)}, max ${fmtMs(timing.max)}`);
    lines.push(table(["Frame", "Stream", "Sequence", "Gap", "Budget"], ranked.slice(0, 10).map(f =>
      [String(f.index), f.stream, f.sequence ?? "unknown", fmtMs(f.gapMs!), f.budgetMs === null ? "unknown" : fmtMs(f.budgetMs)])));
  } else {
    lines.push("Two distinct presentation timestamps on one stream are required to measure a gap.");
  }
  return lines.join("\n");
}

function displayFrame(f: PresentationFrame, traceStartUs: number): string {
  const lines = [`Frame #${f.index} (${f.status}) on ${f.stream}`,
    `Sequence ${f.sequence ?? "unknown"}, source ${f.source}, trace event #${f.eventIndex}`,
    `End offset ${fmtMs(us2ms(f.endUs - traceStartUs))}`,
    `${isDisplaySignal(f) ? "Presentation gap" : "Start interval"}: ${f.gapMs === null ? "unavailable" : fmtMs(f.gapMs)}`];
  if (f.budgetMs !== null) lines.push(`Frame budget: ${fmtMs(f.budgetMs)} (${f.budgetSource})`);
  if (f.dropReason) lines.push(`Reported drop reason: ${f.dropReason}`);
  if (f.stages.length) {
    lines.push(table(["Pipeline stage", "Elapsed", "Evidence", "Event"], f.stages.map(stage =>
      [stage.name, fmtMs(stage.durationMs), stage.basis, String(stage.eventIndex)])));
  }
  return lines.join("\n");
}

export function frames(store: TraceStore, hz?: number): string {
  const display = decodePresentation(store.events, {hz}).frames.filter(isDisplaySignal);
  if (display.length) return displaySummary(display);
  const main = resolveMainThread(store);
  if (!main) return "No renderer main thread found.";

  const { events: rafs, rendered } = frameEvents(store, main);

  if (rafs.length < 2) return "Not enough animation frames found.";

  const gaps: number[] = [];
  for (let i = 1; i < rafs.length; i++) {
    gaps.push(us2ms(rafs[i]!.ts - rafs[i - 1]!.ts));
  }
  const s = stats(gaps);
  const rafDurs = rafs.map((e) => us2ms(e.dur!));
  const ds = stats(rafDurs);

  const lines: string[] = [];
  lines.push(`${rendered ? "Animation frame ticks" : "RAF callbacks (frame service events unavailable)"}: ${rafs.length}`);
  lines.push(``);
  lines.push(rendered ? "Animation tick intervals:" : "Callback start intervals:");
  lines.push(`  Mean:   ${fmtMs(s.mean)}`);
  lines.push(`  Median: ${fmtMs(s.median)}`);
  lines.push(`  P95:    ${fmtMs(s.p95)}`);
  lines.push(`  P99:    ${fmtMs(s.p99)}`);
  lines.push(`  Max:    ${fmtMs(s.max)}`);
  lines.push(`  Intervals over 16.7ms: ${gaps.filter((g) => g > 16.7).length}`);
  lines.push(`  Intervals over 33.3ms: ${gaps.filter((g) => g > 33.3).length}`);
  lines.push(``);
  lines.push(`${rendered ? "Frame animation service duration" : "RAF callback duration"}:`);
  lines.push(`  Mean:   ${fmtMs(ds.mean)}`);
  lines.push(`  Median: ${fmtMs(ds.median)}`);
  lines.push(`  P95:    ${fmtMs(ds.p95)}`);
  lines.push(`  Max:    ${fmtMs(ds.max)}`);

  return lines.join("\n");
}

export function frame(store: TraceStore, which: string, hz?: number): string {
  const decoded = decodePresentation(store.events, {hz}).frames;
  const display = decoded.filter(isDisplaySignal);
  if (display.length) {
    if (which === "worst") {
      const ranked = display.filter(f => f.gapMs !== null);
      if (ranked.length) return displayFrame(ranked.reduce((a, b) => a.gapMs! >= b.gapMs! ? a : b), store.minTs);
      const dropped = display.find(f => f.status === "dropped");
      if (dropped) return "No measured presentation gap; first recorded drop follows.\n" + displayFrame(dropped, store.minTs);
      return "No measured presentation gap to rank. Use a frame index to inspect an individual event.";
    }
    const target = decoded[Number(which)];
    if (!target || !Number.isInteger(Number(which))) return `Invalid frame index. Range: 0-${decoded.length - 1}`;
    return displayFrame(target, store.minTs);
  }
  const main = resolveMainThread(store);
  if (!main) return "No renderer main thread found.";

  const mainEvents = store.events.filter(
    (e) => e.pid === main.pid && e.tid === main.tid
  );

  const { events: rafs, rendered } = frameEvents(store, main);

  if (rafs.length === 0) return "No animation frames found.";

  let target: TraceEvent;
  if (which === "worst") {
    target = rafs.reduce((worst, e) => (e.dur! > worst.dur! ? e : worst));
  } else {
    const idx = Number(which);
    if (!Number.isInteger(idx) || idx < 0 || idx >= rafs.length)
      return `Invalid frame index. Range: 0-${rafs.length - 1}`;
    target = rafs[idx]!;
  }

  const frameStart = target.ts;
  const frameEnd = target.ts + target.dur!;

  const children = mainEvents.filter(
    (e) =>
      e.ph === "X" &&
      e.dur !== undefined &&
      e.ts >= frameStart &&
      e.ts + e.dur! <= frameEnd &&
      e !== target
  );

  const byName = new Map<string, { count: number; totalMs: number }>();
  for (const e of children) {
    if (!e.name) continue;
    const entry = byName.get(e.name) ?? { count: 0, totalMs: 0 };
    entry.count++;
    entry.totalMs += us2ms(e.dur!);
    byName.set(e.name, entry);
  }

  const sorted = [...byName.entries()].sort(
    (a, b) => b[1].totalMs - a[1].totalMs
  );

  const frameIdx = rafs.indexOf(target);
  const lines: string[] = [];
  lines.push(
    `${rendered ? "Animation tick" : "RAF callback"} #${frameIdx}: ${fmtMs(us2ms(target.dur!))} at offset ${fmtMs(us2ms(target.ts - store.minTs))}`
  );
  lines.push(`Child events: ${children.length}\n`);
  lines.push(
    table(
      ["Name", "Total", "Count", "% of interval"],
      sorted.slice(0, 40).map(([name, { count, totalMs }]) => [
        name,
        fmtMs(totalMs),
        String(count),
        target.dur ? `${((totalMs / us2ms(target.dur)) * 100).toFixed(1)}%` : "n/a",
      ]),
      ["l", "r", "r", "r"]
    )
  );

  return lines.join("\n");
}

/** Chrome emits one animation service per frame but may fire several callbacks within it. */
function frameEvents(store: TraceStore, main: { pid: number; tid: number }): { events: TraceEvent[]; rendered: boolean } {
  const onMain = (name: string) => store.events.filter((e) =>
    e.pid === main.pid && e.tid === main.tid && e.name === name && e.ph === "X" && e.dur !== undefined
  ).sort((a, b) => a.ts - b.ts);
  const frames = onMain("PageAnimator::serviceScriptedAnimations");
  return frames.length ? { events: frames, rendered: true } : { events: onMain("FireAnimationFrame"), rendered: false };
}
