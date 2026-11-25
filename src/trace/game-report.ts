import { decodePresentation, type PresentationFrame } from "./presentation.ts";
import { gameMetrics, type GameMetric } from "./game-metrics.ts";
import { stats } from "./format.ts";
import { profileData } from "./commands/profile.ts";
import type { TraceStore } from "./trace-store.ts";

interface Options {
  limit: number;
  pid?: number;
  tid?: number;
  hz?: number;
  from?: number;
  to?: number;
}
function observed(
  store: TraceStore,
  options: Options,
  pid: number,
  tid: number,
  ts: number,
) {
  const ms = (ts - store.minTs) / 1000;
  return (
    (options.pid === undefined || pid === options.pid) &&
    (options.tid === undefined || tid === options.tid) &&
    (options.from === undefined || ms >= options.from) &&
    (options.to === undefined || ms < options.to)
  );
}
function summary(metric: GameMetric) {
  const { detail, ...rest } = metric;
  return rest;
}
function samplesFor(
  store: TraceStore,
  frame: PresentationFrame,
  start: number,
  end: number,
) {
  const samples = store.profileSamples
    .filter((s) => s.pid === frame.pid)
    .flatMap((s) => {
      const ts = Math.min(s.ts, end);
      const durationUs = ts - Math.max(start, s.ts - s.durationUs);
      return durationUs > 0 ? [{ ...s, ts, durationUs }] : [];
    });
  return profileData(store, {}, samples).entries;
}

export function gameReport(
  store: TraceStore,
  command: string,
  selector: string | undefined,
  options: Options,
) {
  const { limit } = options;
  const decoded = gameMetrics(store.events);
  const metrics = decoded.entries.filter((m) =>
    observed(store, options, m.pid, m.tid, m.startUs),
  );
  if (command === "metrics") {
    const pattern = new RegExp(selector ?? "", "i");
    const matches = metrics.filter((m) =>
      [m.name, m.track, m.trackGroup].some((v) => v && pattern.test(v)),
    );
    const groups = new Map<string, number[]>();
    for (const m of matches) {
      const key = [m.trackGroup, m.track, m.name].filter(Boolean).join(" / ");
      const durations = groups.get(key) ?? [];
      durations.push(m.durationUs / 1000);
      groups.set(key, durations);
    }
    return {
      count: matches.length,
      groups: [...groups]
        .slice(0, limit)
        .map(([name, durations]) => ({ name, durationMs: stats(durations) })),
      entries: matches.slice(0, limit),
      warnings: decoded.warnings,
    };
  }
  const timeline = decodePresentation(store.events, options);
  const frames = timeline.frames.filter((f) =>
    observed(store, options, f.pid, f.tid, f.endUs),
  );
  const ranked = [...frames].sort((a, b) => (b.gapMs ?? -1) - (a.gapMs ?? -1));
  if (command === "inventory") {
    const selected = store.events.filter((e) =>
      observed(store, options, e.pid, e.tid, e.ts),
    );
    const sampleCount = store.profileSamples.filter((s) =>
      observed(store, options, s.pid, s.tid, s.ts),
    ).length;
    const validTimers = metrics.filter((m) => m.deviceTiming?.valid).length;
    return {
      traceStartUs: store.minTs,
      durationMs: store.durationMs,
      eventCount: selected.length,
      frameSources: [...new Set(frames.map((f) => f.source))],
      frameCount: frames.length,
      cpuSamples: sampleCount,
      gameMetrics: metrics.length,
      tracks: [...new Set(metrics.map((m) => m.track).filter(Boolean))],
      validDeviceTimers: validTimers,
      guidance: [
        !frames.some(
          (f) => f.status === "presented" || f.status === "partial",
        ) &&
          "Capture compositor presentation feedback to measure visible gaps.",
        !sampleCount &&
          "Enable JavaScript samples in Chrome Performance recording settings for sampled function attribution.",
        !validTimers &&
          "Export WebGL or WebGPU pass times with units, validity and frame IDs to measure device work.",
      ].filter(Boolean),
      threads: store.threads
        .filter(
          (t) =>
            (options.pid === undefined || t.pid === options.pid) &&
            (options.tid === undefined || t.tid === options.tid),
        )
        .slice(0, limit),
      warnings: decoded.warnings,
    };
  }
  if (command === "pacing") {
    const overBudget = frames
      .flatMap((f) => {
        if (f.gapMs === null || f.budgetMs === null || f.gapMs <= f.budgetMs)
          return [];
        return [
          {
            id: f.id,
            source: f.source,
            gapMs: f.gapMs,
            budgetMs: f.budgetMs,
            excessMs: f.gapMs - f.budgetMs,
          },
        ];
      })
      .sort((a, b) => b.excessMs - a.excessMs);
    return {
      overBudgetCount: overBudget.length,
      worstBudgetOverruns: overBudget.slice(0, limit),
      frameCount: frames.length,
      drops: frames.filter((f) => f.status === "dropped").length,
      streams: timeline.streams,
      frames: ranked.slice(0, limit),
    };
  }
  const frame =
    selector && selector !== "worst"
      ? frames.find((f) => f.id === selector)
      : (ranked.find(
          (f) =>
            (f.source === "PipelineReporter" ||
              f.source === "FramePresented") &&
            f.gapMs !== null,
        ) ??
        ranked.find((f) => f.status === "dropped") ??
        ranked[0]);
  if (!frame && selector && selector !== "worst")
    throw new Error("Unknown frame ID. Use pacing to list IDs.");
  if (!frame)
    return {
      frame: null,
      guidance:
        "Record a Chrome Performance trace with animation or compositor frame events.",
    };
  const start = frame.previousUs ?? frame.startUs,
    end = frame.endUs;
  const compatible = (m: GameMetric, f: PresentationFrame) =>
    m.pid === f.pid && m.frameId !== undefined && m.frameId === f.sequence;
  const sequenceCounts = new Map<string, number>();
  for (const f of timeline.frames) {
    const key = [f.pid, f.sequence].join(":");
    sequenceCounts.set(key, (sequenceCounts.get(key) ?? 0) + 1);
  }
  const linked = decoded.entries.filter(
    (m) =>
      compatible(m, frame) &&
      sequenceCounts.get([frame.pid, frame.sequence].join(":")) === 1,
  );
  const scene = linked.find((m) => m.scene)?.scene;
  const sceneIds = new Set(
    decoded.entries
      .filter((m) => m.pid === frame.pid && m.scene === scene)
      .map((m) => m.frameId),
  );
  const neighbors = frames
    .filter(
      (f) =>
        f.stream === frame.stream &&
        f.id !== frame.id &&
        f.gapMs !== null &&
        f.status !== "dropped" &&
        (frame.gapMs === null || f.gapMs < frame.gapMs) &&
        (!scene || sceneIds.has(f.sequence ?? undefined)),
    )
    .sort((a, b) => Math.abs(a.endUs - end) - Math.abs(b.endUs - end))
    .slice(0, 5);
  const nearbyIds = new Set(neighbors.map((f) => f.sequence));
  const comparisons = linked
    .filter((m) => m.kind === "span")
    .slice(0, limit)
    .map((m) => {
      const peers = decoded.entries.filter(
        (p) =>
          p.pid === m.pid &&
          p.name === m.name &&
          p.track === m.track &&
          p.scene === m.scene &&
          p.frameId &&
          nearbyIds.has(p.frameId) &&
          sequenceCounts.get([m.pid, p.frameId].join(":")) === 1,
      );
      return {
        name: m.name,
        eventIndex: m.eventIndex,
        frameMs: m.durationUs / 1000,
        nearbyDurationMs: peers.length
          ? stats(peers.map((p) => p.durationUs / 1000))
          : null,
        nearbyProperties: peers.slice(0, 5).map((p) => p.properties),
      };
    });
  const overlapping = store.events
    .map((e, eventIndex) => ({ e, eventIndex }))
    .filter(
      ({ e }) => e.ph === "X" && e.dur && e.ts < end && e.ts + e.dur > start,
    );
  const eventRow = ({ e, eventIndex }: (typeof overlapping)[number]) => ({
    name: e.name,
    pid: e.pid,
    tid: e.tid,
    startUs: e.ts,
    durationMs: e.dur! / 1000,
    overlapMs: (Math.min(end, e.ts + e.dur!) - Math.max(start, e.ts)) / 1000,
    eventIndex,
  });
  const rows = overlapping
    .map(eventRow)
    .sort((a, b) => b.overlapMs - a.overlapMs);
  const messages = new Map<
    string,
    { eventIndex: number; tid: number; ts: number }
  >();
  const handoffs = [];
  const ordered = store.events
    .map((e, eventIndex) => ({ e, eventIndex }))
    .filter(
      ({ e }) =>
        e.name === "SchedulePostMessage" || e.name === "HandlePostMessage",
    )
    .sort((a, b) => a.e.ts - b.e.ts);
  for (const { e, eventIndex } of ordered) {
    const id = (e.args?.data as Record<string, unknown> | undefined)?.traceId;
    if (
      e.pid !== frame.pid ||
      !(typeof id === "string" || Number.isSafeInteger(id))
    )
      continue;
    if (e.name === "SchedulePostMessage")
      messages.set(String(id), { eventIndex, tid: e.tid, ts: e.ts });
    else {
      const sent = messages.get(String(id));
      messages.delete(String(id));
      if (sent && e.ts >= start && e.ts < end)
        handoffs.push({
          traceId: id,
          send: sent,
          receive: { eventIndex, tid: e.tid, ts: e.ts },
          delayMs: (e.ts - sent.ts) / 1000,
        });
    }
  }
  const gpuThreads = new Set(
    store.threads
      .filter((t) =>
        /gpu|vizcompositor|raster/i.test(t.processName + " " + t.threadName),
      )
      .map((t) => [t.pid, t.tid].join(":")),
  );
  const device = linked.filter((m) => m.deviceTiming?.valid);
  const from = (start - store.minTs) / 1000,
    to = (end - store.minTs) / 1000;
  return {
    frame,
    scene,
    window: { startUs: start, endUs: end },
    frameIdMatches: linked.slice(0, limit).map(summary),
    overlappingGameMetrics: decoded.entries
      .filter(
        (m) =>
          m.pid === frame.pid &&
          !linked.includes(m) &&
          !m.deviceTiming &&
          m.startUs < end &&
          m.startUs + m.durationUs >= start,
      )
      .slice(0, limit)
      .map(summary),
    nearbyFrameGapMs: neighbors.length
      ? stats(neighbors.map((f) => f.gapMs!))
      : null,
    comparisons,
    overlappingCpuSpans: rows
      .filter((r) => r.pid === frame.pid)
      .slice(0, limit),
    sampledFunctions: samplesFor(store, frame, start, end).slice(0, limit),
    workerHandoffs: handoffs.slice(0, limit),
    overlappingGraphicsHostSpans: rows
      .filter((r) => gpuThreads.has([r.pid, r.tid].join(":")))
      .slice(0, limit),
    deviceTimers: device.slice(0, limit).map((m) => m.deviceTiming),
    leads: comparisons
      .flatMap((c) => {
        if (!c.nearbyDurationMs || c.frameMs <= c.nearbyDurationMs.median)
          return [];
        return [
          {
            name: c.name,
            eventIndex: c.eventIndex,
            extraMsOverNearbyMedian: c.frameMs - c.nearbyDurationMs.median,
            followUp:
              "Compare this track?s properties and sampled functions across the matched frames.",
          },
        ];
      })
      .sort((a, b) => b.extraMsOverNearbyMedian - a.extraMsOverNearbyMedian),
    evidenceLimits: [
      !device.length &&
        "No valid game-exported device timer matched this frame.",
      !store.profileSamples.length &&
        "CPU sampling was unavailable. Enable JavaScript samples when recording.",
      "Overlapping work and elapsed pipeline stages alone do not establish a CPU or GPU bottleneck.",
    ].filter(Boolean),
    drillDownArgs: [
      [
        "events",
        "--pid",
        String(frame.pid),
        "--from",
        String(from),
        "--to",
        String(to),
      ],
      [
        "profile",
        "--pid",
        String(frame.pid),
        "--from",
        String(from),
        "--to",
        String(to),
      ],
    ],
  };
}
