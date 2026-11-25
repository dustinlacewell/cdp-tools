import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { TraceStore } from "../../src/trace/trace-store.ts";
import { selfTimes, remapProfile } from "../../src/trace/analysis.ts";

const cli =
  process.env.TRACE_QUERY_TEST_CLI ??
  fileURLToPath(new URL("../../src/trace-query.ts", import.meta.url));
const sample = fileURLToPath(new URL("../../examples/traces/game.json", import.meta.url));
const cdp = process.env.CDP_TEST_CLI ?? fileURLToPath(new URL("../../src/agent.ts", import.meta.url));
function run(args: string[], input?: string | Buffer) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input,
    timeout: 15000,
  });
}

test("every CLI command runs on the game fixture in JSON and text modes", () => {
  const commands = [
    "inventory",
    "pacing",
    "diagnose",
    "metrics",
    "self",
    "events",
    "overview",
    "threads",
    "categories",
    "sources",
    "scripts",
    "names",
    "top",
    "profile",
    "profile-heavy",
    "functions",
    "summarize RunTask",
    "search Physics",
    "slowest RunTask",
    "tree RunTask",
    "calls",
    "group RunTask",
    "frames",
    "frame worst",
    "long-tasks",
    "gc",
    "counters",
    "slices Physics",
    "check RunTask --budget 12",
  ].map((c) => c.split(" "));
  for (const sub of [
    "top",
    "profile",
    "group",
    "frames",
    "gc",
    "long-tasks",
    "health",
  ])
    commands.push([
      "diff",
      sample,
      sub,
      ...(sub === "group" ? ["RunTask"] : []),
    ]);
  for (const args of commands) {
    for (const format of ["text", "json"]) {
      const result = run([sample, ...args, "--format", format]);
      assert.equal(result.status, 0, args.join(" ") + " " + result.stderr);
      assert.ok(result.stdout.trim());
      if (format === "json")
        assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
    }
  }
});

test("diagnose preserves presentation, late device evidence, worker messages and comparison population", () => {
  const result = run([sample, "diagnose", "--format", "json"]);
  const { data } = JSON.parse(result.stdout);
  assert.equal(data.frame.sequence, "104");
  assert.equal(data.frame.gapMs, 33.334);
  assert.equal(data.deviceTimers[0].durationMs, 4.2);
  assert.equal(data.comparisons[0].nearbyDurationMs.median, 2);
  assert.equal(data.workerHandoffs[0].traceId, 104);
  for (const args of data.drillDownArgs)
    assert.equal(run([sample, ...args]).status, 0);
});

test("cdp trace preserves the analyzer JSON and budget exit codes", () => {
  for (const args of [["inventory"], ["diagnose"], ["check", "Physics step", "--budget", "8"]]) {
    const original = run([sample, ...args, "--format", "json"]);
    const merged = spawnSync(process.execPath, [cdp, "trace", args[0]!, sample, ...args.slice(1)], {encoding:"utf8"});
    assert.equal(merged.status, original.status);
    assert.deepEqual(JSON.parse(merged.stdout), JSON.parse(original.stdout));
  }
});

test("plain and gzipped stdin, empty recordings, malformed input and CI exit codes", () => {
  for (const input of ["[]", gzipSync('{"traceEvents":[]}')]) {
    const r = run(["-", "overview", "--format", "json"], input);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.durationMs, 0);
  }
  for (const input of [
    "{",
    "{}",
    "[null]",
    "[] garbage",
    gzipSync("["),
    Buffer.from([31, 139, 0]),
  ]) {
    const r = run(["-", "overview"], input);
    assert.equal(r.status, 1, input.toString());
    assert.equal(r.stdout, "");
  }
  assert.equal(
    run([sample, "check", "Physics step", "--budget", "8"]).status,
    2,
  );
  assert.equal(run([sample, "check", "NoSuchSpan", "--budget", "8"]).status, 1);
  for (const args of [
    ["events", "--limti", "3"],
    ["events", "--pid", "NaN"],
    ["frame", "0.5"],
    ["tree", "("],
  ])
    assert.equal(run([sample, ...args]).status, 1);
});

test("same-thread containment, paired durations, exclusive time and per-process source URLs", () => {
  const span = (name: string, ts: number, dur: number, tid = 1) => ({
    name,
    ts,
    dur,
    pid: 1,
    tid,
    ph: "X",
  });
  const store = new TraceStore({
    traceEvents: [
      { ...span("Scope", 0, 0), ph: "B" },
      { ...span("end", 10, 0), ph: "E" },
      span("Child", 2, 5),
      span("Nested", 3, 1),
      span("Other", 2, 4, 2),
      span("After", 10, 1),
      ...[1, 2].map((pid) => ({
        ...span("ScriptCatchup", 11, 0),
        pid,
        args: { data: { scriptId: "2", url: "bundle" + pid } },
      })),
    ],
  });
  assert.deepEqual(
    store
      .completeEvents({ within: "Scope" })
      .map((e) => e.name)
      .sort(),
    ["Child", "Nested", "Scope"],
  );
  assert.equal(
    selfTimes(store, store.completeEvents({ name: "Scope" }))[0]?.selfMs,
    0.005,
  );
  assert.equal(
    store.eventUrl({
      ...span("Call", 1, 1),
      args: { data: { scriptId: "2" } },
    }),
    "bundle1",
  );
});

test("explicit local source maps resolve sampled frames without fetching sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-query-map-"));
  try {
    const map = join(dir, "game.map");
    writeFileSync(
      map,
      JSON.stringify({
        version: 3,
        sources: ["src/game.ts"],
        names: [],
        mappings: "AAAA",
      }),
    );
    const store = new TraceStore({ traceEvents: [] });
    const node = {
      id: 1,
      callFrame: {
        url: "bundle.js",
        functionName: "tick",
        scriptId: 1,
        lineNumber: 0,
        columnNumber: 0,
      },
    };
    store.profileNodes.set("main", new Map([[1, node]]));
    remapProfile(store, "bundle.js", map);
    assert.match(node.callFrame.url, /src\/game\.ts$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
