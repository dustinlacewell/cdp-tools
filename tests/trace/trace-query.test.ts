import assert from "node:assert/strict";
import { test } from "node:test";
import { TraceStore } from "../../src/trace/trace-store.ts";
import { profileData } from "../../src/trace/commands/profile.ts";
import { frames } from "../../src/trace/commands/frames.ts";
import { gc } from "../../src/trace/commands/gc.ts";
import type { ProfileNode, TraceEvent } from "../../src/trace/types.ts";

const event = (name: string, ts: number, dur: number, tid = 1): TraceEvent =>
  ({ name, ts, dur, pid: 7, tid, ph: "X" });
const node = (id: number, name: string, parent?: number): ProfileNode => ({
  id, parent, callFrame: { functionName: name, scriptId: 1, url: `app/${name}.js`, lineNumber: 0, columnNumber: 0 },
});

test("profile chunks keep their own clocks and same numbered nodes stay on their original profiles", () => {
  const trace = new TraceStore({ traceEvents: [
    { name: "Profile", ph: "P", pid: 7, tid: 1, ts: 100, id: "main", args: { data: { startTime: 100 } } },
    { name: "Profile", ph: "P", pid: 7, tid: 2, ts: 100, id: "worker", args: { data: { startTime: 100 } } },
    event("Scope", 100, 200, 1), event("Scope", 100, 200, 2),
    { name: "ProfileChunk", ph: "P", pid: 7, tid: 9, ts: 1000, id: "main", args: { data: {
      cpuProfile: { nodes: [node(1, "main")] }, timeDeltas: [40],
    } } },
    { name: "ProfileChunk", ph: "P", pid: 7, tid: 9, ts: 1100, id: "worker", args: { data: {
      cpuProfile: { nodes: [node(1, "worker")] }, timeDeltas: [50],
    } } },
    { name: "ProfileChunk", ph: "P", pid: 7, tid: 9, ts: 1200, id: "main", args: { data: {
      cpuProfile: { samples: [1, 1] }, timeDeltas: [60, 100],
    } } },
    { name: "ProfileChunk", ph: "P", pid: 7, tid: 9, ts: 1300, id: "worker", args: { data: {
      cpuProfile: { samples: [1] }, timeDeltas: [80],
    } } },
  ] });
  assert.deepEqual(trace.profileSamples.map((s) => s.ts), [200, 300, 230]);
  assert.deepEqual(trace.profileSamples.map((s) => s.tid), [1, 1, 2]);
  const data = profileData(trace, { within: "Scope" });
  assert.equal(data.matchedSamples, 3);
  assert.equal(data.entries.find((e) => e.name === "main")?.selfMs, 0.16);
  assert.equal(data.entries.find((e) => e.name === "worker")?.selfMs, 0.08);
});

test("a scoped sample uses an event on its own thread and clips its interval", () => {
  const trace = new TraceStore({ traceEvents: [
    { name: "Profile", ph: "P", pid: 7, tid: 1, ts: 100, id: "a", args: { data: { startTime: 100 } } },
    { name: "Profile", ph: "P", pid: 7, tid: 2, ts: 100, id: "b", args: { data: { startTime: 100 } } },
    event("Scope", 150, 25, 1), event("Scope", 155, 5, 1),
    { name: "ProfileChunk", ph: "P", pid: 7, tid: 9, ts: 1000, id: "a", args: { data: {
      cpuProfile: { nodes: [node(1, "main")], samples: [1] }, timeDeltas: [100],
    } } },
    { name: "ProfileChunk", ph: "P", pid: 7, tid: 9, ts: 1000, id: "b", args: { data: {
      cpuProfile: { nodes: [node(1, "worker")], samples: [1] }, timeDeltas: [100],
    } } },
  ] });
  const data = profileData(trace, { within: "Scope" });
  assert.equal(data.matchedSamples, 1);
  assert.equal(data.entries[0]?.name, "main");
  assert.equal(data.entries[0]?.selfMs, 0.025);
});

test("frames count animation services and GC reports only outer main-thread pauses", () => {
  const trace = new TraceStore({ traceEvents: [
    { name: "thread_name", ph: "M", pid: 7, tid: 1, ts: 1, args: { name: "CrRendererMain" } },
    event("PageAnimator::serviceScriptedAnimations", 100, 150),
    event("FireAnimationFrame", 110, 10), event("FireAnimationFrame", 125, 10),
    event("PageAnimator::serviceScriptedAnimations", 16767, 150),
    event("FireAnimationFrame", 16780, 10), event("FireAnimationFrame", 16795, 10),
    event("MinorGC", 300, 50), event("V8.GC_SCAVENGER", 310, 20),
    event("V8.GC_MC_BACKGROUND_MARKING", 300, 100, 2),
  ] });
  assert.match(frames(trace), /Animation frame ticks: 2/);
  assert.match(frames(trace), /16\.67ms/);
  assert.match(gc(trace), /Main-thread GC pauses \(MinorGC \+ MajorGC\): 50µs/);
  assert.match(gc(trace), /Background GC work \(summed thread time\): 100µs/);
});
