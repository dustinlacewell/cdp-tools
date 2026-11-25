import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gameMetrics } from "../../src/trace/game-metrics.ts";
import type { TraceEvent, TraceFile } from "../../src/trace/types.ts";

const measure = (pid: number, ph: string, ts: number): TraceEvent =>
  ({ name: "Tick", cat: "blink.user_timing", pid, tid: 1, ph, ts, id2: { local: "0x5" } });
const stamp = (name: string, ts: number, data: Record<string, unknown> = {}, tid = 1): TraceEvent =>
  ({ name: "TimeStamp", cat: "devtools.timeline", ph: "I", pid: 1, tid, ts, args: { data: { name, ...data } } });

test("measures pair on the trace clock and preserve process-local IDs and extension detail", () => {
  const detail = { devtools: { track: "Physics", trackGroup: "Game", properties: [["Entities", "300"]] }, frameId: 9 };
  const events = [
    measure(9, "e", 120), { ...measure(9, "b", 100), args: { detail: JSON.stringify(detail) } },
    measure(7, "b", 110), measure(7, "e", 112), measure(1, "e", 98),
    { ...measure(9, "I", 120), name: "navigationStart" },
  ];
  const { entries, warnings } = gameMetrics(events);
  assert.deepEqual(entries.map(row => [row.pid, row.durationUs]), [[9, 20], [7, 2]]);
  assert.equal(entries[0]?.track, "Physics");
  assert.equal(entries[0]?.trackGroup, "Game");
  assert.equal(entries[0]?.frameId, "9");
  assert.deepEqual(entries[0]?.properties, [["Entities", "300"]]);
  assert.equal(entries[0]?.endEventIndex, 0);
  assert.match(warnings.join(" "), /1 unpaired/);
});

test("console timestamps resolve trace-clock and named endpoints on their originating thread", () => {
  const { entries, warnings } = gameMetrics([
    stamp("a", 800), stamp("a", 850, {}, 2),
    stamp("Draw", 1000, { start: "a", end: 911, track: "Render", devtools: '{"scene":"Arena"}' }),
    stamp("Skip", 1050, { start: "uncaptured" }), stamp("Reverse", 1060, { start: 1061 }),
    stamp("Zero", 1080, { start: 0, end: 0 }),
  ]);
  const draw = entries.find(m => m.name === "Draw");
  assert.deepEqual([draw?.startUs, draw?.durationUs, draw?.scene], [800, 111, "Arena"]);
  assert.equal(entries.find(m => m.name === "Zero")?.startUs, 0);
  assert.match(warnings.join(" "), /2 console timestamp/);
});

test("game example identifies game measurements and delayed device results", () => {
  const example: TraceFile = JSON.parse(readFileSync(new URL("../../examples/traces/game.json", import.meta.url), "utf8"));
  const { entries, warnings } = gameMetrics(example.traceEvents);
  assert.deepEqual(warnings, []);
  const slow = entries.find(m => m.frameId === "104" && m.source === "performance.measure");
  assert.deepEqual([slow?.track, slow?.durationUs, slow?.scene], ["Simulation", 11000, "Arena"]);
  const result = entries.find(m => m.deviceTiming);
  assert.deepEqual(result?.deviceTiming, { api: "webgpu", durationMs: 4.2, valid: true, pass: "Shadows", frameId: "104" });
  assert.equal(result?.startUs, 1103500);
});

test("device timing requires explicit units and preserves a timer's invalid status", () => {
  const timer = { api: "webgl", frameId: 12, pass: "Bloom", duration: 7200, unit: "us", valid: false };
  const marker = (data: unknown): TraceEvent => ({
    pid: 7, tid: 1, ts: 100, name: "timer returned", cat: "blink.user_timing", ph: "I",
    args: { data: { detail: JSON.stringify({ traceQueryGpu: data, quality: "high" }) } },
  });
  const { entries } = gameMetrics([marker(timer), marker({ ...timer, unit: "ticks" })]);
  assert.deepEqual(entries[0]?.deviceTiming, { api: "webgl", frameId: "12", pass: "Bloom", durationMs: 7.2, valid: false });
  assert.equal(entries[1]?.deviceTiming, undefined);
  assert.deepEqual(entries[1]?.detail, { traceQueryGpu: { ...timer, unit: "ticks" }, quality: "high" });
});
