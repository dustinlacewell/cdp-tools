#!/usr/bin/env npx tsx
/** Watch heap + extension state, alert on spikes.
 *  Usage: watch.ts [interval-ms] [spike-threshold-mb] [page-match]
 */
import { findPage, evaluate } from "../src/cdp.ts";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probe = readFileSync(resolve(__dirname, "probes/combined-probe.js"), "utf-8");

const interval = Number(process.argv[2]) || 2000;
const spikeThreshold = Number(process.argv[3]) || 100;
const page = await findPage(process.argv[4]);

let prevHeap = 0;

interface Timing {
  phase: string;
  tick: number;
  loopCount: number;
  lastOrigUpdateMs: number;
  lastGameLoopMs: number;
  lastDetectUnitsMs: number;
  lastSnapshotMs: number;
  maxOrigUpdateMs: number;
  maxGameLoopMs: number;
}

process.stdout.write(
  "time\theap\ttotal\tplayers\tticks\tgold\ttimeline\tpending\tphase\tupdMs\tloopMs\tmaxUpd\tmaxLoop\tSPIKE\n",
);

while (true) {
  try {
    const raw = await evaluate(page, probe);
    const d = JSON.parse(raw) as Record<string, unknown>;
    const heap = d["heap"] as number;
    const spike = prevHeap > 0 && heap - prevHeap > spikeThreshold;
    const time = new Date().toLocaleTimeString();
    const t = (d["timing"] ?? {}) as Partial<Timing>;

    process.stdout.write(
      `${time}\t${heap}\t${d["total"]}\t${d["playerCount"] ?? "-"}\t${d["ticks"] ?? "-"}\t${d["goldEvents"] ?? "-"}\t${d["timelineEvents"] ?? "-"}\t${d["pendingCount"] ?? "-"}\t${t.phase ?? "-"}\t${t.lastOrigUpdateMs ?? "-"}\t${t.lastGameLoopMs ?? "-"}\t${t.maxOrigUpdateMs ?? "-"}\t${t.maxGameLoopMs ?? "-"}\t${spike ? ">>> SPIKE " + (heap - prevHeap) + "MB <<<" : ""}\n`,
    );

    if (spike) {
      process.stderr.write(
        `\n!!! HEAP SPIKE: ${prevHeap}MB -> ${heap}MB (+${heap - prevHeap}MB) !!!\n\n`,
      );
    }

    prevHeap = heap;
  } catch (e) {
    // On timeout, try to read localStorage for last known timing
    try {
      const lsRaw = await evaluate(page, "localStorage.getItem('ofstats-dbg-timing') || 'null'");
      if (lsRaw !== "null") {
        process.stderr.write(`LAST TIMING BEFORE CRASH: ${lsRaw}\n`);
      }
    } catch { /* page is truly dead */ }
    process.stderr.write(`poll error: ${(e as Error).message}\n`);
  }
  await new Promise((r) => setTimeout(r, interval));
}
