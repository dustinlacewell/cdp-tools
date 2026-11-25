// Feed this example a complete trace-query 1.0 pacing or metrics JSON report.
import { readFileSync } from "node:fs";

function evaluate(report, budgetMs) {
  if (report?.schemaVersion !== 1 || !["pacing", "metrics"].includes(report.command))
    throw new Error("Expected a trace-query 1.0 pacing or metrics JSON report.");
  const pacing = report.command === "pacing";
  const rows = pacing ? report.data?.frames : report.data?.entries;
  const count = pacing ? report.data?.frameCount : report.data?.count;
  if (!Array.isArray(rows) || !Number.isSafeInteger(count) || count < 0)
    throw new Error("Missing report rows or count.");
  if (rows.length !== count)
    throw new Error(`Received ${rows.length} of ${count} rows. Rerun trace-query with --limit ${count}.`);

  const groups = new Map();
  function record(identity, durationMs) {
    const key = JSON.stringify(identity);
    const group = groups.get(key) ?? { ...identity, values: [], unmeasured: 0 };
    if (durationMs === null) group.unmeasured++;
    else if (Number.isFinite(durationMs) && durationMs >= 0) group.values.push(durationMs);
    else throw new Error("Invalid duration in " + key);
    groups.set(key, group);
  }
  for (const row of rows) {
    if (pacing) {
      if (!["PipelineReporter", "FramePresented"].includes(row.source)) continue;
      record({ stream: row.stream }, row.gapMs);
    } else if (row.deviceTiming) {
      const timer = row.deviceTiming;
      record({ pid: row.pid, api: timer.api, pass: timer.pass }, timer.valid === true ? timer.durationMs : null);
    }
  }
  if (!groups.size)
    throw new Error(pacing ? "No presentation feedback in this selection." : "No GPU device timers in this selection.");

  const results = [];
  for (const { values, ...group } of groups.values()) {
    values.sort((a, b) => a - b);
    // Match the percentile definition used by the 1.0 check command.
    const p95Ms = values[Math.floor(values.length * 0.95)] ?? null;
    results.push({ ...group, count: values.length, p95Ms,
      status: p95Ms === null ? "unmeasured" : p95Ms > budgetMs ? "breach" : "pass" });
  }
  return { budgetMs, results };
}

try {
  const [raw, ...extra] = process.argv.slice(2);
  const budgetMs = Number(raw);
  if (extra.length || !raw?.trim() || !Number.isFinite(budgetMs) || budgetMs < 0)
    throw new Error("Usage: node examples/check-game-budget.mjs <p95-budget-ms> < report.json");
  const result = evaluate(JSON.parse(readFileSync(0, "utf8")), budgetMs);
  console.log(JSON.stringify(result));
  if (result.results.some(group => group.status === "unmeasured")) process.exitCode = 1;
  else if (result.results.some(group => group.status === "breach")) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
