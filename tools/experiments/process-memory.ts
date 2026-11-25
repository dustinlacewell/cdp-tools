#!/usr/bin/env npx tsx
/** Monitor all Chrome process memory via Windows tasklist + CDP heap.
 *  Usage: process-memory.ts [interval-ms] [page-match]
 */
import { findPage, evaluate } from "../../src/cdp.ts";
import { execSync } from "child_process";

const interval = Number(process.argv[2]) || 3000;
const page = await findPage(process.argv[3]);
console.error(`Watching: ${page.title}`);

// Get browser-level WS to find process IDs
const versionRes = await fetch("http://127.0.0.1:9222/json/version");
const version = (await versionRes.json()) as { webSocketDebuggerUrl: string };

function getChromeMemory(): { total: number; top: { pid: string; mb: number }[] } {
  const output = execSync(
    'tasklist /fi "imagename eq chrome.exe" /fo csv /nh',
    { encoding: "utf-8" },
  );
  const procs: { pid: string; mb: number }[] = [];
  let total = 0;
  for (const line of output.trim().split("\n")) {
    const parts = line.split('","');
    if (parts.length < 5) continue;
    const pid = parts[1]?.replace(/"/g, "") ?? "";
    const memStr = parts[4]?.replace(/"/g, "").replace(/[, K]/g, "") ?? "0";
    const mb = Math.round(Number(memStr) / 1024);
    total += mb;
    procs.push({ pid, mb });
  }
  procs.sort((a, b) => b.mb - a.mb);
  return { total, top: procs.slice(0, 5) };
}

console.log("time\tjsHeap\ttotalProc\ttop1\ttop2\ttop3\tgameData");

while (true) {
  try {
    const [heapRaw, procMem] = await Promise.all([
      evaluate(page, `JSON.stringify({
        h: Math.round(performance.memory?.usedJSHeapSize/1048576),
        t: Math.round(performance.memory?.totalJSHeapSize/1048576),
        l: Math.round(performance.memory?.jsHeapSizeLimit/1048576),
      })`),
      Promise.resolve(getChromeMemory()),
    ]);

    const heap = JSON.parse(heapRaw);
    const dbgRaw = await evaluate(page, `document.querySelector('#ofstats-root')?.dataset?.dbg || '{}'`);
    const dbg = JSON.parse(dbgRaw);

    const time = new Date().toLocaleTimeString();
    const tops = procMem.top.slice(0, 3).map((p) => `${p.mb}MB(${p.pid})`).join("\t");

    console.log(
      `${time}\t${heap.h}/${heap.t}/${heap.l}\t${procMem.total}MB\t${tops}\ttick=${dbg.ticks ?? "-"} gold=${dbg.goldEvents ?? "-"} tl=${dbg.timelineEvents ?? "-"}`,
    );
  } catch (e) {
    console.log(`${new Date().toLocaleTimeString()}\tERROR: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, interval));
}
