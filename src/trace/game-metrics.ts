import type { TraceEvent } from "./types.ts";

type Fields = Record<string, unknown>;
type Source = "performance.mark" | "performance.measure" | "console.timeStamp";

export interface DeviceTiming {
  frameId: string;
  pass: string;
  api: "webgl" | "webgpu";
  durationMs: number;
  valid: boolean;
}

export interface GameMetric {
  name: string;
  source: Source;
  kind: "marker" | "span";
  pid: number;
  tid: number;
  startUs: number;
  durationUs: number;
  eventIndex: number;
  endEventIndex?: number;
  track?: string;
  trackGroup?: string;
  color?: string;
  tooltipText?: string;
  properties?: unknown;
  detail?: unknown;
  frameId?: string;
  scene?: string;
  deviceTiming?: DeviceTiming;
}

// These reserved names also use blink.user_timing for browser-generated timings.
const browserTimings = new Set((
  "navigationStart unloadEventStart unloadEventEnd redirectStart redirectEnd fetchStart " +
  "domainLookupStart domainLookupEnd connectStart connectEnd secureConnectionStart requestStart " +
  "responseStart responseEnd domLoading domInteractive domContentLoadedEventStart domContentLoadedEventEnd " +
  "domComplete loadEventStart loadEventEnd workerStart commitNavigationEnd"
).split(" "));

function fields(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string" ? String(value) : undefined;
}

function parseDetail(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function readDeviceTiming(value: unknown): DeviceTiming | undefined {
  const { frameId, pass, api, duration, unit, valid } = fields(value);
  const id = identifier(frameId);
  if (!id || typeof pass !== "string" || !pass || (api !== "webgl" && api !== "webgpu") ||
      typeof valid !== "boolean" || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) return;
  const factor = unit === "ms" ? 1 : unit === "us" ? 0.001 : unit === "ns" ? 0.000001 : undefined;
  if (factor === undefined) return;
  return { frameId: id, pass, api, durationMs: duration * factor, valid };
}

function metric(event: TraceEvent, eventIndex: number, source: Source, name: string, startUs: number,
                durationUs: number, kind: GameMetric["kind"], detail: unknown, style: Fields): GameMetric {
  const data = fields(detail);
  const deviceTiming = readDeviceTiming(data.traceQueryGpu);
  return {
    name, source, kind, pid: event.pid, tid: event.tid, startUs, durationUs, eventIndex,
    track: string(style.track), trackGroup: string(style.trackGroup), color: string(style.color),
    tooltipText: string(style.tooltipText), properties: style.properties, detail,
    frameId: deviceTiming?.frameId ?? identifier(data.frameId), scene: string(data.scene), deviceTiming,
  };
}

function measureKey(e: TraceEvent): string | undefined {
  const local = e.id2?.local;
  const id = local ?? e.id2?.global ?? e.id;
  if (id === undefined) return;
  return JSON.stringify([local === undefined ? null : e.pid, String(id), e.cat, (e as TraceEvent & { scope?: string }).scope, e.name]);
}

/** Decode exported trace clocks in microseconds. eventIndex points to the input array. */
export function gameMetrics(events: readonly TraceEvent[]): { entries: GameMetric[]; warnings: string[] } {
  const candidates: { event: TraceEvent; index: number }[] = [];
  const entries: GameMetric[] = [];
  const warnings: string[] = [];
  const labels = new Map<string, number>();
  const pending = new Map<string, number[]>();
  let unmatched = 0;
  let invalidConsole = 0;
  for (const [index, event] of events.entries()) {
    const categories = event.cat?.split(",") ?? [];
    if (categories.includes("blink.user_timing") && !browserTimings.has(event.name ?? "") ||
        event.name === "TimeStamp" && categories.includes("devtools.timeline")) {
      candidates.push({ event, index });
    }
  }
  candidates.sort((a, b) => a.event.ts - b.event.ts || a.index - b.index);
  for (const { event, index } of candidates) {
    const data = fields(event.args?.data);
    if (event.name === "TimeStamp" && event.cat?.split(",").includes("devtools.timeline")) {
      const name = identifier(data.name ?? data.message);
      if (name === undefined) continue;
      const labelKey = (label: string) => JSON.stringify([event.pid, event.tid, data.frame ?? "", label]);
      labels.set(labelKey(name), event.ts);
      // Chrome converts numeric performance.now() endpoints into absolute trace
      // microseconds before export. Named endpoints reference previous calls.
      const endpoint = (value: unknown): number | undefined => {
        if (value === undefined) return event.ts;
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string") return labels.get(labelKey(value));
      };
      const start = endpoint(data.start);
      const end = endpoint(data.end);
      if (start === undefined || end === undefined || start > end) { invalidConsole++; continue; }
      entries.push(metric(event, index, "console.timeStamp", name, start, end - start,
        data.start === undefined && data.end === undefined ? "marker" : "span", parseDetail(data.devtools), data));
      continue;
    }
    if (!event.name) continue;
    if (event.ph === "I" || event.ph === "R" || event.ph === "i") {
      const detail = parseDetail(data.detail ?? event.args?.detail);
      entries.push(metric(event, index, "performance.mark", event.name, event.ts, 0, "marker",
        detail, fields(fields(detail).devtools)));
      continue;
    }
    if (event.ph !== "b" && event.ph !== "e") continue;
    const key = measureKey(event);
    if (key === undefined) { unmatched++; continue; }
    const stack = pending.get(key) ?? [];
    if (event.ph === "b") {
      stack.push(index);
      pending.set(key, stack);
      continue;
    }
    const beginIndex = stack.pop();
    if (beginIndex === undefined) { unmatched++; continue; }
    if (!stack.length) pending.delete(key);
    const begin = events[beginIndex]!;
    const detail = parseDetail(begin.args?.detail ?? fields(begin.args?.data).detail);
    entries.push({ ...metric(begin, beginIndex, "performance.measure", event.name, begin.ts, event.ts - begin.ts,
      "span", detail, fields(fields(detail).devtools)), endEventIndex: index });
  }
  for (const stack of pending.values()) unmatched += stack.length;
  if (unmatched) warnings.push(`${unmatched} unpaired User Timing measure endpoint(s).`);
  if (invalidConsole) warnings.push(`${invalidConsole} console timestamp(s) with unresolved or inverted boundaries.`);
  entries.sort((a, b) => a.startUs - b.startUs || a.eventIndex - b.eventIndex);
  return { entries, warnings };
}
