import assert from "node:assert/strict";
import { test } from "node:test";
import { counterSeries, sliceData } from "../../src/trace/commands/async.ts";
import type { TraceEvent } from "../../src/trace/types.ts";

const e = (ph: string, ts: number, extra: Partial<TraceEvent> & { scope?: string } = {}): TraceEvent =>
  ({ ph, ts, pid: 1, tid: 1, cat: "game", name: "Tick", ...extra });

test("slice IDs preserve category, explicit scope and process locality", () => {
  const local = { id2: { local: "4" } };
  const global = { id2: { global: "4" } };
  const events = [
    e("b", 10, local), e("b", 11, { ...local, pid: 2 }), e("b", 12, global),
    e("e", 15, { ...local, cat: "another" }), e("e", 16, { ...local, scope: "another" }),
    e("e", 18, { ...global, pid: 3 }), e("e", 20, { ...local, pid: 2 }), e("e", 30, local),
    e("b", 99), e("e", 111),
  ];
  assert.deepEqual(sliceData(events, "Tick", 10).map(s => [s.pid, s.endPid, s.durationUs]),
    [[1, 1, 20], [2, 2, 9], [1, 3, 6]]);
});

test("nested repeated IDs, unnamed sync ends and legacy cross-thread events consume each end once", () => {
  const events = [e("B", 1), e("B", 2, { name: "inner" }), e("E", 3, { name: undefined }),
    e("E", 8, { name: undefined }), e("b", 9, { id: "1" }), e("b", 11, { id: "1" }),
    e("e", 11, { id: "1" }), e("e", 19, { id: "1", tid: 5, pid: 4 }),
    e("S", 100, { id: "1" }), e("F", 103, { id: "1", tid: 5 })];
  assert.deepEqual(sliceData(events, "Tick", 10).map(s => [s.source, s.durationUs]),
    [["async", 10], ["sync", 7], ["legacy-async", 3], ["async", 0]]);
});

test("counter rows separate fields and processes and last follows timestamps", () => {
  const rows = counterSeries([
    e("C", 80, { args: { count: 5, bytes: 120, note: "extra" } }),
    e("C", 20, { args: { count: 7, bytes: 300 } }),
    e("C", 12, { args: { count: 12 }, pid: 2 }),
  ]);
  assert.deepEqual(rows.map(s => [s.field, s.pid, s.samples, s.min, s.max, s.last]),
    [["count", 1, 2, 5, 7, 5], ["bytes", 1, 2, 120, 300, 120], ["count", 2, 1, 12, 12, 12]]);
});
