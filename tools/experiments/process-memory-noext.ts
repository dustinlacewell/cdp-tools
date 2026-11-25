#!/usr/bin/env npx tsx
/** Monitor Chrome process memory WITHOUT extension.
 *  Simpler version - no extension data, just heap + process mem.
 */
import { findPage, evaluate } from "../../src/cdp.ts";
import { execSync } from "child_process";

const interval = Number(process.argv[2]) || 3000;
const page = await findPage(process.argv[3]);
console.error(`Watching: ${page.title}`);

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

console.log("time\tjsHeap\tjsTotal\ttotalProc\ttop1\ttop2\ttop3");

while (true) {
  try {
    const heapRaw = await evaluate(page,
      `JSON.stringify({h:Math.round(performance.memory?.usedJSHeapSize/1048576),t:Math.round(performance.memory?.totalJSHeapSize/1048576)})`
    );
    const heap = JSON.parse(heapRaw);
    const procMem = getChromeMemory();
    const time = new Date().toLocaleTimeString();
    const tops = procMem.top.slice(0, 3).map((p) => `${p.mb}MB(${p.pid})`).join("\t");
    console.log(`${time}\t${heap.h}\t${heap.t}\t${procMem.total}MB\t${tops}`);
  } catch (e) {
    console.log(`${new Date().toLocaleTimeString()}\tERROR: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, interval));
}
