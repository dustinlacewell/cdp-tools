#!/usr/bin/env npx tsx
/** Allocation sampling profiler via CDP.
 *  Usage: profile-alloc.ts [duration-sec] [output.cpuprofile] [page-match]
 *
 *  Starts the V8 allocation sampler, waits, then saves the profile.
 *  The output can be loaded in Chrome DevTools → Memory → Allocation sampling.
 */
import { findPage } from "../src/cdp.ts";
import { writeFileSync } from "fs";

const duration = Number(process.argv[2]) || 30;
const outFile = process.argv[3] || `alloc-${Date.now()}.heapprofile`;
const page = await findPage(process.argv[4]);

console.error(`Connected to: ${page.title} (${page.url})`);
console.error(`Sampling allocations for ${duration}s...`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;

function cdpSend(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 30_000);
    const handler = (evt: MessageEvent) => {
      const msg = JSON.parse(String(evt.data)) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id === id) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener("open", async () => {
  try {
    await cdpSend("HeapProfiler.enable");
    await cdpSend("HeapProfiler.startSampling", {
      // Sample every 256 bytes for high resolution
      samplingInterval: 256,
    });

    console.error(`Sampling started. Waiting ${duration}s...`);
    await new Promise((r) => setTimeout(r, duration * 1000));

    console.error("Stopping sampler...");
    const result = (await cdpSend("HeapProfiler.stopSampling")) as {
      profile: unknown;
    };

    writeFileSync(outFile, JSON.stringify(result.profile, null, 2));
    console.error(`Saved allocation profile → ${outFile}`);

    ws.close();
    process.exit(0);
  } catch (e) {
    console.error("Error:", (e as Error).message);
    ws.close();
    process.exit(1);
  }
});

ws.addEventListener("error", (e) => {
  console.error("WS error:", (e as ErrorEvent).message);
  process.exit(1);
});
