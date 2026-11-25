#!/usr/bin/env npx tsx
/** Debug: what CDP events fire during a heap snapshot? */
import { findPage } from "../../src/cdp.ts";

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const methods = new Set<string>();
let msgCount = 0;

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ id: ++id, method: "HeapProfiler.enable" }));
});

ws.addEventListener("message", (evt) => {
  const msg = JSON.parse(String(evt.data)) as {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
  };
  msgCount++;

  if (msg.id === 1) {
    console.log("enable response:", JSON.stringify(msg));
    ws.send(JSON.stringify({
      id: ++id,
      method: "HeapProfiler.takeHeapSnapshot",
      params: { reportProgress: true },
    }));
  }

  if (msg.method) {
    if (!methods.has(msg.method)) {
      methods.add(msg.method);
      console.log("NEW EVENT:", msg.method);
    }
  }

  if (msgCount % 500 === 0) {
    console.log("msgs:", msgCount, "methods:", [...methods]);
  }

  if (msg.method === "HeapProfiler.reportHeapSnapshotProgress" && msg.params?.["finished"]) {
    console.log("DONE. total msgs:", msgCount, "Unique events:", [...methods]);
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => {
  console.log("TIMEOUT. msgs:", msgCount, "Methods:", [...methods]);
  process.exit(1);
}, 60_000);
