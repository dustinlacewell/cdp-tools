// Query __ofStatsStore in the content script execution context.
import { findPage } from "../cdp.ts";

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);

let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 10000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener("message", (evt) => {
  const msg = JSON.parse(String(evt.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, timer } = pending.get(msg.id);
    clearTimeout(timer);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 500));

// Find content script context
let contentCtxId = null;
const ctxHandler = (evt) => {
  const msg = JSON.parse(String(evt.data));
  if (msg.method === "Runtime.executionContextCreated") {
    const ctx = msg.params.context;
    if (ctx.name === "OpenFront Stats") contentCtxId = ctx.id;
  }
};
ws.addEventListener("message", ctxHandler);
await send("Runtime.disable");
await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 500));
ws.removeEventListener("message", ctxHandler);

if (!contentCtxId) {
  console.log("ERROR: Could not find content script context");
  ws.close();
  process.exit(1);
}

console.log("Content script context ID:", contentCtxId);

const result = await send("Runtime.evaluate", {
  contextId: contentCtxId,
  expression: `
    (function() {
      var store = globalThis.__ofStatsStore;
      if (!store) return JSON.stringify({error: 'no __ofStatsStore'});
      var state = store.getState();
      if (!state) return JSON.stringify({error: 'getState returned null'});
      var rec = state.liveRecord;
      if (!rec) return JSON.stringify({error: 'no liveRecord', gameActive: state.gameActive});

      var tlByType = {};
      for (var i = 0; i < rec.timelineEvents.length; i++) {
        var e = rec.timelineEvents[i];
        tlByType[e.eventType] = (tlByType[e.eventType] || 0) + 1;
      }

      var goldByType = {};
      for (var i = 0; i < rec.goldEvents.length; i++) {
        var e = rec.goldEvents[i];
        goldByType[e.eventType] = (goldByType[e.eventType] || 0) + 1;
      }

      // Sample some non-bonus timeline events
      var interestingEvents = rec.timelineEvents.filter(function(e) {
        return e.eventType !== 'bonusGold' && e.eventType !== 'bonusTroops';
      }).slice(0, 20);

      return JSON.stringify({
        gameActive: state.gameActive,
        tickCount: rec.series.ticks.length,
        playerCount: Object.keys(rec.players).length,
        totalTimelineEvents: rec.timelineEvents.length,
        timelineEventsByType: tlByType,
        totalGoldEvents: rec.goldEvents.length,
        goldEventsByType: goldByType,
        interestingTimelineEvents: interestingEvents,
      }, null, 2);
    })()
  `,
  returnByValue: true,
});

console.log(result.result?.value);
ws.close();
