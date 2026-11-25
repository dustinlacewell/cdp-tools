import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rmdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// Run pnpm build first. Arguments are simulation ticks and repetitions.
// 25,000 ticks produce 100,101 trace events plus 25,000 CPU samples.
const ticks = Number(process.argv[2] ?? 25_000);
const repetitions = Number(process.argv[3] ?? 3);
if (!Number.isSafeInteger(ticks) || ticks < 4 || ticks > 1_000_000 ||
    !Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 100) {
  throw new Error("Usage: node scripts/benchmark.mjs [ticks: 4–1000000] [repetitions: 1–100]");
}

const baseUs = 1_000_000;
const tickUs = 4_000;
const chunkSize = 256;
const profileId = "worker";
function* traceEvents() {
  for (const [tid, name] of [[1, "CrRendererMain"], [2, "DedicatedWorker thread"]]) {
    yield { ph: "M", pid: 7, tid, ts: 0, name: "thread_name", args: { name } };
  }
  yield { ph: "P", pid: 7, tid: 2, ts: baseUs, name: "Profile", id: profileId,
    args: { data: { startTime: baseUs } } };
  for (let tick = 0; tick < ticks; tick++) {
    const ts = baseUs + tick * tickUs;
    const dur = 600 + tick % 11 * 100;
    yield { ph: "X", pid: 7, tid: 2, ts, dur: dur + 200, name: "Simulation", cat: "game" };
    yield { ph: "X", pid: 7, tid: 2, ts: ts + 50, dur, name: "PhysicsStep", cat: "game" };
    yield { ph: "X", pid: 7, tid: 1, ts: ts + 2100, dur: 750, name: "HandlePostMessage", cat: "devtools.timeline" };
    yield { ph: "C", pid: 7, tid: 2, ts: ts + 3000, name: "Scene", cat: "game", args: { entities: 240 + tick % 100 } };
    if ((tick + 1) % chunkSize === 0 || tick + 1 === ticks) {
      const count = tick % chunkSize + 1;
      const cpuProfile = { samples: Array(count).fill(1) };
      if (tick < chunkSize) {
        cpuProfile.nodes = [{ id: 1, callFrame: { functionName: "stepPhysics", scriptId: 1,
          url: "game.js", lineNumber: 9, columnNumber: 0 } }];
      }
      yield { name: "ProfileChunk", ph: "P", id: profileId, pid: 7, tid: 2, ts: ts + tickUs,
        args: { data: { cpuProfile, timeDeltas: Array(count).fill(tickUs) } } };
    }
  }
}

function* serializeTrace() {
  yield '{"traceEvents":[';
  let batch = "";
  let separator = "";
  for (const event of traceEvents()) {
    batch += separator + JSON.stringify(event);
    separator = ",\n";
    if (batch.length >= 65_536) {
      yield batch;
      batch = "";
    }
  }
  yield batch + "]}";
}

const cliPath = fileURLToPath(new URL("../../dist/trace-query.js", import.meta.url));
// An ESM preload runs inside each CLI process, including when the CLI calls process.exit().
const hook = `import {writeSync} from "node:fs";
  process.on("exit", () => writeSync(2, "\\nBENCH_PEAK_RSS_KIB=" + process.resourceUsage().maxRSS + "\\n"));`;
const preload = "data:text/javascript," + encodeURIComponent(hook);
function runQuery(tracePath, args, expectedText) {
  const start = performance.now();
  const child = spawnSync(process.execPath, ["--import", preload, cliPath, tracePath, ...args, "--format", "json"],
    { encoding: "utf8", windowsHide: true, timeout: 300_000 });
  const wallMs = performance.now() - start;
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(args.join(" ") + ": " + child.stderr);
  const report = JSON.parse(child.stdout);
  if (!JSON.stringify(report).includes(expectedText)) throw new Error("Unexpected result from " + args.join(" "));
  const peakKiB = Number(child.stderr.match(/BENCH_PEAK_RSS_KIB=(\d+)/)?.[1]);
  if (!(peakKiB > 0)) throw new Error("The child process did not report peak RSS.");
  return { wallMs: Math.round(wallMs), peakRssMiB: Math.round(peakKiB / 1024 * 10) / 10 };
}

const scope = ["--pid", "7", "--tid", "2", "--from", String(ticks), "--to", String(ticks * 2)];
const queries = [
  { args: ["inventory"], expected: "cpuSamples" },
  { args: ["events", "PhysicsStep", ...scope, "--limit", "5"], expected: "PhysicsStep" },
  { args: ["profile", ...scope, "--limit", "5"], expected: "stepPhysics" },
];
const directory = await mkdtemp(join(tmpdir(), "trace-query-benchmark-"));
const capture = join(directory, "simulation.json");
try {
  await pipeline(serializeTrace(), createWriteStream(capture));
  const results = [];
  for (const { args, expected } of queries) {
    const runs = [];
    for (let i = 0; i < repetitions; i++) runs.push(runQuery(capture, args, expected));
    results.push({ command: args, runs });
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    traceEvents: 3 + 4 * ticks + Math.ceil(ticks / chunkSize), cpuSamples: ticks,
    traceBytes: (await stat(capture)).size, repetitions, results }, null, 2));
} finally {
  await unlink(capture).catch((error) => { if (error.code !== "ENOENT") throw error; });
  await rmdir(directory);
}
