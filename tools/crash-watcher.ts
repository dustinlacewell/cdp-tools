#!/usr/bin/env npx tsx
/** Watch for tab crash via CDP Inspector.targetCrashed event.
 *  Also monitors page responsiveness by timing eval round-trips.
 *  Usage: crash-watcher.ts [poll-ms] [page-match]
 */
import { findPage } from "../src/cdp.ts";

const pollMs = Number(process.argv[2]) || 1000;
const page = await findPage(process.argv[3]);

console.error(`Watching: ${page.title}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;

function cdpSend(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => reject(new Error(`${method} timeout (10s)`)), 10_000);
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

// Listen for crash/detach events
ws.addEventListener("message", (evt) => {
  const msg = JSON.parse(String(evt.data)) as { method?: string; params?: unknown };
  if (msg.method === "Inspector.targetCrashed") {
    const ts = new Date().toISOString();
    console.log(`\n!!! TARGET CRASHED at ${ts} !!!`);
    console.log("Event:", JSON.stringify(msg, null, 2));
    process.exit(0);
  }
  if (msg.method === "Inspector.detached") {
    const ts = new Date().toISOString();
    console.log(`\n!!! INSPECTOR DETACHED at ${ts} !!!`);
    console.log("Reason:", JSON.stringify(msg.params));
    process.exit(0);
  }
});

ws.addEventListener("close", () => {
  console.log(`\n!!! WEBSOCKET CLOSED at ${new Date().toISOString()} !!!`);
  process.exit(0);
});

ws.addEventListener("open", async () => {
  // Enable Inspector domain to receive crash events
  await cdpSend("Inspector.enable");
  // Enable Performance domain
  await cdpSend("Performance.enable");

  console.log("time\trespMs\theapMB\theapPct\tdomNodes\tlisteners");

  while (true) {
    const t0 = Date.now();
    try {
      // Time the round-trip — if this takes >1s the main thread is choking
      const [evalResult, metricsResult] = await Promise.all([
        cdpSend("Runtime.evaluate", {
          expression: "JSON.stringify({h:Math.round(performance.memory?.usedJSHeapSize/1048576),l:Math.round(performance.memory?.jsHeapSizeLimit/1048576)})",
          returnByValue: true,
        }),
        cdpSend("Performance.getMetrics"),
      ]);

      const respMs = Date.now() - t0;
      const val = (evalResult as any)?.result?.value;
      const mem = val ? JSON.parse(val) : { h: 0, l: 0 };
      const pct = mem.l > 0 ? Math.round((mem.h / mem.l) * 100) : 0;

      const metrics = (metricsResult as any)?.metrics ?? [];
      const mMap = Object.fromEntries(metrics.map((m: any) => [m.name, m.value]));

      const time = new Date().toLocaleTimeString();
      console.log(`${time}\t${respMs}\t${mem.h}\t${pct}%\t${mMap["Nodes"] ?? "-"}\t${mMap["JSEventListeners"] ?? "-"}`);

      if (respMs > 2000) {
        console.log(`  ^^^ SLOW RESPONSE: ${respMs}ms — main thread is starving`);
      }
    } catch (e) {
      console.log(`${new Date().toLocaleTimeString()}\tERROR\t${(e as Error).message}`);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
});
