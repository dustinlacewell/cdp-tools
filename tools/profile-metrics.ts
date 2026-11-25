#!/usr/bin/env npx tsx
/** Poll V8 performance metrics via CDP.
 *  Usage: profile-metrics.ts [interval-ms] [page-match]
 *
 *  Reports detailed JS heap breakdown, DOM nodes, event listeners, etc.
 */
import { findPage } from "../src/cdp.ts";

const interval = Number(process.argv[2]) || 2000;
const page = await findPage(process.argv[3]);

console.error(`Connected to: ${page.title} (${page.url})`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;

function cdpSend(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 10_000);
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
  await cdpSend("Performance.enable");

  process.stdout.write("time\tJSHeapUsed\tJSHeapTotal\tDOMNodes\tListeners\tFrames\tLayoutCount\tLayoutDur\tScriptDur\tTaskDur\n");

  while (true) {
    try {
      const res = (await cdpSend("Performance.getMetrics")) as {
        metrics: { name: string; value: number }[];
      };
      const m = Object.fromEntries(res.metrics.map((x) => [x.name, x.value]));
      const time = new Date().toLocaleTimeString();

      process.stdout.write(
        `${time}\t${mb(m["JSHeapUsedSize"])}\t${mb(m["JSHeapTotalSize"])}\t${m["Nodes"] ?? "-"}\t${m["JSEventListeners"] ?? "-"}\t${m["Frames"] ?? "-"}\t${m["LayoutCount"] ?? "-"}\t${ms(m["LayoutDuration"])}\t${ms(m["ScriptDuration"])}\t${ms(m["TaskDuration"])}\n`,
      );
    } catch (e) {
      process.stderr.write(`poll error: ${(e as Error).message}\n`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
});

function mb(bytes: number | undefined): string {
  return bytes != null ? (bytes / 1048576).toFixed(1) : "-";
}
function ms(sec: number | undefined): string {
  return sec != null ? (sec * 1000).toFixed(0) : "-";
}

ws.addEventListener("error", (e) => {
  console.error("WS error:", (e as ErrorEvent).message);
  process.exit(1);
});
