import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodePresentation } from "../../src/trace/presentation.ts";
import type { TraceEvent } from "../../src/trace/types.ts";

test("Chrome canvas presentation feedback and linked stage durations match the exported trace", () => {
  const file = JSON.parse(readFileSync(new URL("fixtures/chrome-canvas-pipeline.json", import.meta.url), "utf8"));
  const report = decodePresentation(file.traceEvents);
  assert.equal(report.source, "PipelineReporter");
  assert.equal(report.streams.length, 1);
  assert.deepEqual(report.frames.map(f => f.sequence), ["7", "8", "9"]);
  assert.deepEqual(report.frames.map(f => f.endUs), [19825, 35982, 53817]);
  assert.deepEqual(report.frames.map(f => f.gapMs), [null, 16.157, 17.835]);
  for (const frame of report.frames) {
    assert.equal(frame.budgetMs, 16.666);
    assert.equal(frame.budgetSource, "recorded");
    assert.ok(frame.stages.some(s => s.name === "SwapEndToPresentationCompositorFrame" && s.endUs === frame.endUs));
    assert.equal(file.traceEvents[frame.eventIndex].name, "PipelineReporter");
  }
});

const reporter = (pid: number, sequence: number, ts: number, state: string): TraceEvent => ({
  pid, tid: 1, ts, dur: 50, ph: "X", name: "PipelineReporter",
  args: {chrome_frame_reporter: {state, frame_source: 1, frame_sequence: sequence, layer_tree_host_id: 1}},
});

test("a dropped reporter and an unrelated renderer never reset the presentation clock", () => {
  const a = [
    reporter(1, 1, 120, "STATE_PRESENTED_ALL"),
    reporter(2, 1, 150, "STATE_PRESENTED_ALL"),
    reporter(1, 2, 190, "STATE_DROPPED"),
    reporter(1, 3, 260, "STATE_PRESENTED_PARTIAL"),
    reporter(1, 4, 270, "STATE_NO_UPDATE_DESIRED"),
  ];
  assert.deepEqual(decodePresentation(a).frames.map(f => f.gapMs), [null, null, null, 0.14]);
  const {frames} = decodePresentation(a, {pid: 1, hz: 120});
  assert.deepEqual(frames.map(f => f.status), ["presented", "dropped", "partial"]);
  assert.equal(frames[2]?.budgetMs, 1000 / 120);
});

test("reports the strongest available source on each renderer and ignores unmatched async ends", () => {
  const events: TraceEvent[] = [
    {pid: 1, tid: 1, ts: 1, ph: "R", cat: "cc,benchmark", name: "FramePresented"},
    {pid: 1, tid: 2, ts: 2, ph: "X", dur: 0.5, name: "FireAnimationFrame"},
    {pid: 2, tid: 1, ts: 3, ph: "X", dur: 2, name: "PageAnimator::serviceScriptedAnimations"},
    {pid: 2, tid: 1, ts: 3, ph: "X", dur: 1, name: "FireAnimationFrame"},
    {pid: 2, tid: 1, ts: 4, ph: "e", id: "1", name: "PipelineReporter"},
  ];
  assert.deepEqual(decodePresentation(events).frames.map(f => f.source), ["FramePresented", "AnimationService"]);
  assert.equal(decodePresentation(events, {pid: 1, tid: 2}).frames[0]?.status, "callback");
});

test("links cross-process host stages only through exact render IDs", () => {
  const frame = reporter(1, 1, 100, "STATE_PRESENTED_ALL");
  Object.assign(frame.args!.chrome_frame_reporter as object, {
    surface_frame_trace_id: "0xf1000000000000a1", display_trace_id: 2 ** 60,
  });
  const stage = (data: object): TraceEvent => ({
    pid: 9, tid: 5, name: "Graphics.Pipeline", ph: "X", ts: 110, dur: 15,
    args: {chrome_graphics_pipeline: {step: "STEP_RECEIVE_COMPOSITOR_FRAME", ...data}},
  });
  const {frames} = decodePresentation([frame, stage({surface_frame_trace_id: "0xf1000000000000a1"}),
    stage({display_trace_id: 2 ** 60}), stage({surface_frame_trace_id: "0xf1000000000000a2"})], {pid: 1});
  assert.deepEqual(frames[0]?.stages.map(s => [s.basis, s.eventIndex, s.pid]), [["surface-id", 1, 9]]);
});

test("a standalone partial-drop marker never supplies presentation feedback", () => {
  const {frames} = decodePresentation([{pid: 1, tid: 2, ts: 100, ph: "I", name: "DroppedFrame",
    args: {layerTreeId: 1, frameSeqId: 4, hasPartialUpdate: true}}]);
  assert.equal(frames[0]?.status, "partial");
  assert.equal(frames[0]?.gapMs, null);
});

test("frames and frame worst choose the longest measured presentation gap on a real capture", async () => {
  const { TraceStore } = await import("../../src/trace/trace-store.ts");
  const commands = await import("../../src/trace/commands/frames.ts");
  const store = new TraceStore(JSON.parse(readFileSync(new URL("fixtures/chrome-canvas-pipeline.json", import.meta.url), "utf8")));
  assert.match(commands.frames(store), /3 presented, 0 partial, 0 dropped/);
  assert.match(commands.frames(store), /max 17\.84ms/);
  const worst = commands.frame(store, "worst");
  assert.match(worst, /Frame #2 \(presented\)/);
  assert.match(worst, /Sequence 9/);
  assert.match(worst, /SwapEndToPresentationCompositorFrame/);
  assert.equal(worst, commands.frame(store, "2"));
  assert.match(commands.frame(store, "1"), /Sequence 8/);
});
