import { readFileSync } from "fs";
import type {
  TraceFile,
  TraceEvent,
  ThreadInfo,
  ProfileNode,
  ProfileSample,
  TimeRange,
} from "./types.ts";

/**
 * Parses and indexes a Chrome trace file for structured querying.
 */
export class TraceStore {
  events: TraceEvent[];
  readonly metadata: Record<string, unknown>;

  private processNames = new Map<number, string>();
  private threadNames = new Map<string, string>();
  private threadEventCounts = new Map<string, number>();

  /** scriptId (as string) → URL */
  private scriptUrlsByProcess = new Map<string, string>();
  readonly scriptUrls = new Map<string, string>();

  /** CPU profile nodes, keyed by process/profile and then node id. */
  readonly profileNodes = new Map<string, Map<number, ProfileNode>>();

  /** CPU profile samples: array of { nodeId, timestamp } */
  profileSamples: ProfileSample[] = [];

  readonly minTs: number;
  readonly maxTs: number;

  constructor(file: TraceFile) {
    this.metadata = file.metadata ?? {};
    this.events = file.traceEvents.slice();
    const stacks = new Map<string, TraceEvent[]>();
    const boundaries = this.events
      .filter((e) => e.ph === "B" || e.ph === "E")
      .sort((a, b) => a.ts - b.ts);
    for (const e of boundaries) {
      const key = `${e.pid}:${e.tid}`;
      const stack = stacks.get(key) ?? [];
      if (e.ph === "B") {
        stack.push(e);
        stacks.set(key, stack);
      } else {
        const start = stack.pop();
        if (start)
          this.events.push({ ...start, ph: "X", dur: e.ts - start.ts });
      }
    }

    const profiles = new Map<string, { time: number; tid: number }>();
    for (const e of this.events) {
      if (e.name === "Profile" && e.id !== undefined) {
        const start = (
          e.args?.["data"] as Record<string, unknown> | undefined
        )?.["startTime"];
        profiles.set(`${e.pid}:${e.id}`, {
          time: typeof start === "number" ? start : e.ts,
          tid: e.tid,
        });
      }
    }
    for (const e of this.events) {
      if (e.ph === "M") {
        if (e.name === "process_name" && e.args) {
          this.processNames.set(e.pid, e.args["name"] as string);
        }
        if (e.name === "thread_name" && e.args) {
          this.threadNames.set(`${e.pid}:${e.tid}`, e.args["name"] as string);
        }
      }
      const key = `${e.pid}:${e.tid}`;
      this.threadEventCounts.set(
        key,
        (this.threadEventCounts.get(key) ?? 0) + 1,
      );

      if (e.name === "ScriptCatchup" || e.name === "FunctionCall") {
        const data = e.args?.data as Record<string, unknown> | undefined;
        if (data?.scriptId !== undefined && typeof data.url === "string") {
          this.registerScript(e.pid, String(data.scriptId), data.url);
        }
      }

      // Index CPU profile data from ProfileChunk events
      if (e.name === "ProfileChunk" && e.args) {
        const profileKey = `${e.pid}:${e.id ?? e.tid}`;
        const profile = profiles.get(profileKey) ?? { time: e.ts, tid: e.tid };
        profiles.set(profileKey, profile);
        const nodesForProfile =
          this.profileNodes.get(profileKey) ?? new Map<number, ProfileNode>();
        this.profileNodes.set(profileKey, nodesForProfile);
        const cpuProfile = (
          e.args["data"] as Record<string, unknown> | undefined
        )?.["cpuProfile"] as Record<string, unknown> | undefined;
        if (cpuProfile) {
          const nodes = cpuProfile["nodes"] as ProfileNode[] | undefined;
          if (nodes) {
            for (const node of nodes) {
              if (!node?.callFrame || !Number.isInteger(node.id)) continue;
              nodesForProfile.set(node.id, node);
              // Also index URLs from profile call frames
              if (node.callFrame.url && node.callFrame.scriptId) {
                this.registerScript(
                  e.pid,
                  String(node.callFrame.scriptId),
                  node.callFrame.url,
                );
              }
            }
          }
          const samples = cpuProfile["samples"] as number[] | undefined;
          const timeDeltas = (e.args["data"] as Record<string, unknown>)?.[
            "timeDeltas"
          ] as number[] | undefined;
          if (timeDeltas) {
            for (let i = 0; i < timeDeltas.length; i++) {
              const durationUs = timeDeltas[i] ?? 0;
              if (!Number.isFinite(durationUs) || durationUs < 0) continue;
              profile.time += durationUs;
              if (samples?.[i] !== undefined)
                this.profileSamples.push({
                  profileKey,
                  nodeId: samples[i]!,
                  ts: profile.time,
                  durationUs,
                  pid: e.pid,
                  tid: profile.tid,
                });
            }
          }
        }
      }
    }

    for (const nodes of this.profileNodes.values()) {
      for (const node of nodes.values()) {
        for (const childId of node.children ?? []) {
          const child = nodes.get(childId);
          if (child && child.parent === undefined) child.parent = node.id;
        }
      }
    }
    let min = Infinity;
    let max = -Infinity;
    for (const e of this.events) {
      if (e.ts !== 0 || e.ph !== "M") {
        if (e.ts < min) min = e.ts;
        const end = e.ts + (e.dur ?? 0);
        if (end > max) max = end;
      }
    }
    this.minTs = Number.isFinite(min) ? min : 0;
    this.maxTs = Number.isFinite(max) ? max : this.minTs;
  }

  private registerScript(pid: number, id: string, url: string) {
    this.scriptUrlsByProcess.set([pid, id].join(":"), url);
    this.scriptUrls.set(id, url);
  }

  scriptsFor(pid?: number) {
    return [...this.scriptUrlsByProcess]
      .map(([key, url]) => {
        const separator = key.indexOf(":");
        return {
          pid: Number(key.slice(0, separator)),
          scriptId: key.slice(separator + 1),
          url,
        };
      })
      .filter((s) => pid === undefined || s.pid === pid);
  }

  static fromFile(path: string): TraceStore {
    const raw = readFileSync(path, "utf-8");
    const data: TraceFile = JSON.parse(raw);
    return new TraceStore(data);
  }

  private windowDurationMs?: number;
  get durationMs(): number {
    if (this.windowDurationMs !== undefined) return this.windowDurationMs;
    return (this.maxTs - this.minTs) / 1000;
  }

  profileNode(
    sample: Pick<ProfileSample, "profileKey" | "nodeId">,
  ): ProfileNode | undefined {
    return this.profileNodes.get(sample.profileKey)?.get(sample.nodeId);
  }

  get threads(): ThreadInfo[] {
    const result: ThreadInfo[] = [];
    for (const [key, count] of this.threadEventCounts) {
      const [pidStr, tidStr] = key.split(":");
      const pid = Number(pidStr);
      const tid = Number(tidStr);
      result.push({
        pid,
        tid,
        processName: this.processNames.get(pid) ?? `pid:${pid}`,
        threadName: this.threadNames.get(key) ?? `tid:${tid}`,
        eventCount: count,
      });
    }
    return result.sort((a, b) => b.eventCount - a.eventCount);
  }

  threadOf(e: TraceEvent): ThreadInfo {
    const key = `${e.pid}:${e.tid}`;
    return {
      pid: e.pid,
      tid: e.tid,
      processName: this.processNames.get(e.pid) ?? `pid:${e.pid}`,
      threadName: this.threadNames.get(key) ?? `tid:${e.tid}`,
      eventCount: this.threadEventCounts.get(key) ?? 0,
    };
  }

  /** Get the URL associated with a script event via args.data.url or scriptId lookup */
  eventUrl(e: TraceEvent): string | null {
    const data = e.args?.["data"] as Record<string, unknown> | undefined;
    if (data?.["url"] && typeof data["url"] === "string") {
      return data["url"] as string;
    }
    if (data?.["scriptName"] && typeof data["scriptName"] === "string") {
      return data["scriptName"] as string;
    }
    if (data?.["scriptId"] !== undefined) {
      return (
        this.scriptUrlsByProcess.get([e.pid, data.scriptId].join(":")) ?? null
      );
    }
    return null;
  }

  private spans = new Map<string, TraceEvent[]>();
  private spansIndexed = false;
  children(parent: TraceEvent): TraceEvent[] {
    if (!this.spansIndexed) {
      for (const e of this.completeEvents()) {
        const key = [e.pid, e.tid].join(":");
        const list = this.spans.get(key) ?? [];
        list.push(e);
        this.spans.set(key, list);
      }
      for (const list of this.spans.values())
        list.sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
      this.spansIndexed = true;
    }
    const list = this.spans.get([parent.pid, parent.tid].join(":")) ?? [];
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (list[mid]!.ts < parent.ts) lo = mid + 1;
      else hi = mid;
    }
    const end = parent.ts + parent.dur!;
    const result: TraceEvent[] = [];
    for (let i = lo; i < list.length && list[i]!.ts < end; i++) {
      const child = list[i]!;
      if (
        child !== parent &&
        child.ts + child.dur! <= end &&
        child.dur! < parent.dur!
      )
        result.push(child);
    }
    return result;
  }

  directChildren(parent: TraceEvent): TraceEvent[] {
    const direct: TraceEvent[] = [];
    let coverEnd = -Infinity;
    for (const child of this.children(parent)) {
      if (child.ts >= coverEnd) {
        direct.push(child);
        coverEnd = child.ts + child.dur!;
      }
    }
    return direct;
  }

  private rangesFor(
    pattern: string | RegExp | TraceEvent[],
  ): Map<string, TimeRange[]> {
    const byThread = new Map<string, TimeRange[]>();
    for (const event of Array.isArray(pattern)
      ? pattern
      : this.completeEvents({ name: pattern })) {
      const key = [event.pid, event.tid].join(":");
      const ranges = byThread.get(key) ?? [];
      ranges.push({ start: event.ts, end: event.ts + event.dur! });
      byThread.set(key, ranges);
    }
    for (const [key, ranges] of byThread)
      byThread.set(key, mergeRanges(ranges.sort((a, b) => a.start - b.start)));
    return byThread;
  }

  /** Apply a CLI scope after resolving profile clocks. Keep original clock coordinates. */
  scope(pid?: number, tid?: number, fromMs?: number, toMs?: number): void {
    if ([pid, tid, fromMs, toMs].every((v) => v === undefined)) return;
    const start = fromMs === undefined ? -Infinity : this.minTs + fromMs * 1000;
    const end = toMs === undefined ? Infinity : this.minTs + toMs * 1000;
    this.windowDurationMs =
      Math.max(0, Math.min(end, this.maxTs) - Math.max(start, this.minTs)) /
      1000;
    const thread = (e: { pid: number; tid: number }) =>
      (pid === undefined || e.pid === pid) &&
      (tid === undefined || e.tid === tid);
    this.events = this.events.filter(
      (e) => thread(e) && (e.ph === "M" || (e.ts >= start && e.ts < end)),
    );
    this.spans.clear();
    this.spansIndexed = false;
    this.threadEventCounts.clear();
    for (const e of this.events) {
      const key = [e.pid, e.tid].join(":");
      this.threadEventCounts.set(
        key,
        (this.threadEventCounts.get(key) ?? 0) + 1,
      );
    }
    this.profileSamples = this.profileSamples.filter(thread).flatMap((s) => {
      const ts = Math.min(end, s.ts);
      const durationUs = ts - Math.max(start, s.ts - s.durationUs);
      return durationUs > 0 ? [{ ...s, ts, durationUs }] : [];
    });
  }

  /** All complete events (ph=X with dur) */
  completeEvents(filter?: {
    pid?: number;
    tid?: number;
    name?: string | RegExp;
    cat?: string;
    minDurUs?: number;
    origin?: string | RegExp;
    within?: string | RegExp;
  }): TraceEvent[] {
    let result = this.events.filter((e) => e.ph === "X" && e.dur !== undefined);
    if (filter?.pid !== undefined)
      result = result.filter((e) => e.pid === filter.pid);
    if (filter?.tid !== undefined)
      result = result.filter((e) => e.tid === filter.tid);
    if (filter?.name !== undefined) {
      const re =
        typeof filter.name === "string"
          ? new RegExp(filter.name, "i")
          : filter.name;
      result = result.filter((e) => e.name && re.test(e.name));
    }
    if (filter?.cat !== undefined)
      result = result.filter((e) => e.cat?.includes(filter.cat!));
    if (filter?.minDurUs !== undefined)
      result = result.filter((e) => e.dur! >= filter.minDurUs!);
    if (filter?.origin !== undefined) {
      const re =
        typeof filter.origin === "string"
          ? new RegExp(filter.origin, "i")
          : filter.origin;
      result = result.filter((e) => {
        const url = this.eventUrl(e);
        return url !== null && re.test(url);
      });
    }
    if (filter?.within !== undefined) {
      const ranges = this.rangesFor(filter.within);
      result = result.filter((e) => {
        const list = ranges.get([e.pid, e.tid].join(":")) ?? [];
        const range = list[firstEndingAfter(list, e.ts)];
        return range !== undefined && range.start <= e.ts;
      });
    }
    return result;
  }

  /** Filter profile samples by origin and/or time ranges */
  filteredProfileSamples(opts: {
    origin?: string;
    within?: string | TraceEvent[];
  }): ProfileSample[] {
    let samples = this.profileSamples;

    if (opts.within) {
      const byThread = this.rangesFor(opts.within);
      samples = samples.flatMap((sample) => {
        const ranges = byThread.get(`${sample.pid}:${sample.tid}`) ?? [];
        // A sample represents the interval ending at ts. Clip it to the
        // matching event so a long gap cannot inflate scoped time.
        const start = sample.ts - sample.durationUs;
        let covered = 0;
        for (let i = firstEndingAfter(ranges, start); i < ranges.length; i++) {
          const range = ranges[i]!;
          if (range.start >= sample.ts) break;
          if (range.end <= start) continue;
          covered += Math.max(
            0,
            Math.min(sample.ts, range.end) - Math.max(start, range.start),
          );
        }
        return covered > 0
          ? [{ ...sample, durationUs: Math.min(covered, sample.durationUs) }]
          : [];
      });
    }

    return samples;
  }
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const merged: TimeRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function firstEndingAfter(ranges: TimeRange[], ts: number): number {
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ranges[mid]!.end <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
