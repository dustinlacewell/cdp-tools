#!/usr/bin/env npx tsx
/** Poll heap + extension state every N seconds. Usage: monitor.ts [interval-ms] [page-match] */
import { findPage, evaluate } from "../src/cdp.ts";

const interval = Number(process.argv[2]) || 1000;
const page = await findPage(process.argv[3]);

const expr = `JSON.stringify({
  ts: Date.now(),
  heapMB: Math.round(performance.memory?.usedJSHeapSize / 1048576),
  totalMB: Math.round(performance.memory?.totalJSHeapSize / 1048576),
  url: location.href,
})`;

process.stdout.write("ts\theapMB\ttotalMB\turl\n");

while (true) {
  try {
    const raw = await evaluate(page, expr);
    const d = JSON.parse(raw) as Record<string, unknown>;
    process.stdout.write(`${d["ts"]}\t${d["heapMB"]}\t${d["totalMB"]}\t${d["url"]}\n`);
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
  }
  await new Promise((r) => setTimeout(r, interval));
}
