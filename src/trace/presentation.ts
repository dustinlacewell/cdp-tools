import type { TraceEvent } from "./types.ts";

export type FrameSource = "PipelineReporter" | "FramePresented" | "AnimationService" | "RAF" | "DroppedFrame";
type Status = "presented" | "partial" | "dropped" | "tick" | "callback";

export interface PipelineStage {
  name: string;
  basis: "reporter-track" | "surface-id" | "display-id";
  pid: number;
  tid: number;
  startUs: number;
  endUs: number;
  durationMs: number;
  eventIndex: number;
  endEventIndex: number;
}

export interface PresentationFrame {
  id: string;
  index: number;
  pid: number;
  tid: number;
  stream: string;
  source: FrameSource;
  status: Status;
  sequence: string | null;
  startUs: number;
  endUs: number;
  previousUs: number | null;
  gapMs: number | null;
  budgetMs: number | null;
  budgetSource: "specified" | "recorded" | null;
  eventIndex: number;
  endEventIndex: number;
  stages: PipelineStage[];
  dropReason?: string;
  highLatencyStages?: string[];
  affectsSmoothness?: boolean;
}

type Entry = { event: TraceEvent; index: number };
type Signal = Omit<PresentationFrame, "id" | "index" | "previousUs" | "gapMs" | "budgetMs" | "budgetSource">;
type Options = { pid?: number; tid?: number; hz?: number };
type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  return value !== null && typeof value === "object" ? value as Fields : {};
}

function identity(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" && value.length ? value : null;
}

function asyncKey(e: TraceEvent): string | null {
  const id = identity(e.id2?.global ?? e.id2?.local ?? e.id);
  if (id === null) return null;
  return JSON.stringify([e.id2?.global !== undefined ? "global" : e.pid, e.cat, e.args?.scope ?? (e as TraceEvent & {scope?: string}).scope, id]);
}

function report(begin: Entry, end: Entry, endUs: number, stages: PipelineStage[]): Signal | null {
  const e = begin.event;
  const data = fields(e.args?.frame_reporter ?? e.args?.chrome_frame_reporter);
  let status: Status;
  switch (data.state) {
    case "STATE_PRESENTED_ALL": status = "presented"; break;
    case "STATE_PRESENTED_PARTIAL": status = "partial"; break;
    case "STATE_DROPPED": status = "dropped"; break;
    default: return null;
  }
  const sequence = identity(data.frame_sequence);
  // Source and sequence identify a BeginFrame. Layer tree hosts can share a source.
  const stream = [e.pid, "pipeline", identity(data.layer_tree_host_id) ?? e.tid, identity(data.frame_source) ?? "?"].join("/");
  return { pid: e.pid, tid: e.tid, stream, source: "PipelineReporter", status, sequence, startUs: e.ts, endUs,
    eventIndex: begin.index, endEventIndex: end.index, stages,
    dropReason: typeof data.reason === "string" ? data.reason : undefined,
    affectsSmoothness: typeof data.affects_smoothness === "boolean" ? data.affects_smoothness : undefined,
    highLatencyStages: Array.isArray(data.high_latency_contribution_stage)
      ? data.high_latency_contribution_stage.filter((s): s is string => typeof s === "string") : undefined };
}

// Chromium records pipeline stage transitions as nested async spans on the
// reporter's track. Their durations are elapsed pipeline time, including waits.
const stageNames = new Set([
  "BeginImplFrameToSendBeginMainFrame", "SendBeginMainFrameToCommit", "Commit",
  "EndCommitToActivation", "Activation", "EndActivateToSubmitCompositorFrame",
  "SubmitCompositorFrameToPresentationCompositorFrame", "SubmitToReceiveCompositorFrame",
  "ReceiveCompositorFrameToStartDraw", "StartDrawToSwapStart", "SwapStartToSwapEnd",
  "SwapEndToPresentationCompositorFrame", "SubmitToPresentationCompositorFrame",
]);

function reporterSignals(entries: Entry[]): Signal[] {
  const result: Signal[] = [];
  const tracks = new Map<string, { begin: Entry; open: Map<string, Entry[]>; stages: PipelineStage[] }>();
  for (const entry of entries) {
    const e = entry.event;
    if (e.name === "PipelineReporter" && e.ph === "X" && e.dur !== undefined) {
      const signal = report(entry, entry, e.ts + e.dur, []);
      if (signal) result.push(signal);
      continue;
    }
    const key = asyncKey(e);
    if (!key) continue;
    if (e.name === "PipelineReporter" && e.ph === "b") {
      tracks.set(key, { begin: entry, open: new Map(), stages: [] });
      continue;
    }
    const track = tracks.get(key);
    if (!track) continue;
    if (e.name === "PipelineReporter" && e.ph === "e") {
      const signal = report(track.begin, entry, e.ts, track.stages.sort((a, b) => a.startUs - b.startUs));
      if (signal) result.push(signal);
      tracks.delete(key);
    } else if (e.name && stageNames.has(e.name)) {
      const open = track.open.get(e.name) ?? [];
      if (e.ph === "b") {
        open.push(entry);
        track.open.set(e.name, open);
      } else if (e.ph === "e") {
        const start = open.pop();
        if (start) track.stages.push({ name: e.name, basis: "reporter-track", pid: start.event.pid, tid: start.event.tid,
          startUs: start.event.ts, endUs: e.ts,
          durationMs: (e.ts - start.event.ts) / 1000, eventIndex: start.index, endEventIndex: entry.index });
      }
    }
  }
  return result;
}

function simpleSignal(entry: Entry): Signal | null {
  const e = entry.event;
  const instant = ["I", "i", "R"].includes(e.ph);
  let status: Status, source: FrameSource;
  if (instant && e.name === "FramePresented") {
    source = "FramePresented"; status = "presented";
  } else if (instant && e.name === "DroppedFrame") {
    source = "DroppedFrame"; status = e.args?.hasPartialUpdate === true ? "partial" : "dropped";
  } else if (e.ph === "X" && e.name === "PageAnimator::serviceScriptedAnimations") {
    source = "AnimationService"; status = "tick";
  } else if (e.ph === "X" && e.name === "FireAnimationFrame") {
    source = "RAF"; status = "callback";
  } else return null;
  const sequence = identity(e.args?.frameSeqId ?? e.args?.frame_sequence);
  const stream = [e.pid, source, e.tid, identity(e.args?.layerTreeId) ?? "?"].join("/");
  return { pid: e.pid, tid: e.tid, source, status, stream, sequence, startUs: e.ts, endUs: e.ts + (e.dur ?? 0),
    eventIndex: entry.index, endEventIndex: entry.index, stages: [] };
}

const quality: Record<FrameSource, number> = {
  PipelineReporter: 4, FramePresented: 3, AnimationService: 2, RAF: 1, DroppedFrame: 0,
};

function clockUs(frame: Signal): number {
  return frame.status === "tick" || frame.status === "callback" ? frame.startUs : frame.endUs;
}

function graphicsKeys(data: Fields): [string, "surface-id" | "display-id"][] {
  const keys: [string, "surface-id" | "display-id"][] = [];
  const surface = identity(data.surface_frame_trace_id);
  const display = identity(data.display_trace_id);
  if (surface !== null) keys.push(["surface/" + surface, "surface-id"]);
  if (display !== null) keys.push(["display/" + display, "display-id"]);
  return keys;
}

function indexGraphics(events: readonly TraceEvent[]) {
  const result = new Map<string, PipelineStage[]>();
  for (const [index, event] of events.entries()) {
    if (event.name !== "Graphics.Pipeline" || event.ph !== "X" || event.dur === undefined) continue;
    const data = fields(event.args?.chrome_graphics_pipeline);
    if (typeof data.step !== "string") continue;
    for (const [key, basis] of graphicsKeys(data)) {
      const group = result.get(key) ?? [];
      group.push({ name: data.step, basis, pid: event.pid, tid: event.tid, startUs: event.ts,
        endUs: event.ts + event.dur, durationMs: event.dur / 1000, eventIndex: index, endEventIndex: index });
      result.set(key, group);
    }
  }
  return result;
}

export function decodePresentation(events: readonly TraceEvent[], options: Options = {}) {
  if (options.hz !== undefined && (!Number.isFinite(options.hz) || options.hz <= 0)) throw new Error("Refresh rate must be positive.");
  const rendererPids = new Set<number>();
  const budgets = new Map<string, number>();
  const entries: Entry[] = [];
  const signals: Signal[] = [];
  for (const [index, e] of events.entries()) {
    if (options.pid !== undefined && options.pid !== e.pid) continue;
    if (e.ph === "M" && (e.name === "thread_name" && e.args?.name === "CrRendererMain" ||
        e.name === "process_name" && e.args?.name === "Renderer")) rendererPids.add(e.pid);
    if (options.tid !== undefined && options.tid !== e.tid) continue;
    if (e.name === "Scheduler::BeginFrame") {
      const args = fields(e.args?.args);
      if (typeof args.frame_time_us === "number" && typeof args.interval_us === "number" && args.interval_us > 0) {
        budgets.set([e.pid, e.tid, args.frame_time_us, args.sequence_number].join("/"), args.interval_us / 1000);
      }
    }
    if (e.name === "PipelineReporter" || (e.name && stageNames.has(e.name))) entries.push({ event: e, index });
    else {
      const simple = simpleSignal({ event: e, index });
      if (simple) signals.push(simple);
    }
  }
  entries.sort((a, b) => a.event.ts - b.event.ts || a.index - b.index);
  for (const signal of reporterSignals(entries)) signals.push(signal);
  const ranks = new Map<number, number>();
  for (const s of signals) ranks.set(s.pid, Math.max(ranks.get(s.pid) ?? 0, quality[s.source]));
  const selected = signals.filter(s => {
    if (options.pid === undefined && options.tid === undefined && rendererPids.size && !rendererPids.has(s.pid)) return false;
    const rank = ranks.get(s.pid)!;
    return quality[s.source] === rank || (s.source === "DroppedFrame" && rank < quality.PipelineReporter);
  });
  selected.sort((a, b) => clockUs(a) - clockUs(b) || a.eventIndex - b.eventIndex);
  const graphics = indexGraphics(events);
  const lastTimestamp = new Map<string, number>();
  const frames: PresentationFrame[] = [];
  for (const s of selected) {
    // A standalone DroppedFrame marker can describe a partial update but carries
    // no presentation timestamp. A discarded reporter also cannot advance it.
    const clock = clockUs(s);
    if (s.source === "PipelineReporter") {
      const args = events[s.eventIndex]?.args;
      const data = fields(args?.frame_reporter ?? args?.chrome_frame_reporter);
      const seen = new Set<number>();
      for (const [key] of graphicsKeys(data)) {
        for (const stage of graphics.get(key) ?? []) {
          if (seen.has(stage.eventIndex) || stage.startUs < s.startUs || stage.startUs > s.endUs) continue;
          seen.add(stage.eventIndex);
          s.stages.push(stage);
        }
      }
      s.stages.sort((a, b) => a.startUs - b.startUs || a.eventIndex - b.eventIndex);
    }
    const previous = lastTimestamp.get(s.stream) ?? null;
    const updatesClock = s.status !== "dropped" && s.source !== "DroppedFrame";
    const gapMs = updatesClock && previous !== null && clock > previous ? (clock - previous) / 1000 : null;
    if (updatesClock) lastTimestamp.set(s.stream, clock);
    const recorded = budgets.get([s.pid, s.tid, s.startUs, s.sequence].join("/"));
    const frame: PresentationFrame = { ...s, id: s.stream + "/event-" + s.eventIndex, index: frames.length,
      previousUs: previous, gapMs, budgetMs: options.hz ? 1000 / options.hz : recorded ?? null,
      budgetSource: options.hz ? "specified" : recorded !== undefined ? "recorded" : null };
    frames.push(frame);
  }
  const streams = [...new Set(frames.map(f => f.stream))];
  const sources = [...new Set(frames.map(f => f.source))];
  return { frames, streams, source: sources.length === 1 ? sources[0]! : sources.length ? "mixed" : "unavailable" };
}
