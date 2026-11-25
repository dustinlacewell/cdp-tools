// Check what timelineEvents memo actually produces vs what's in the record.
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
let contentCtxId = null;
const ctxHandler = (evt) => {
  const msg = JSON.parse(String(evt.data));
  if (msg.method === "Runtime.executionContextCreated") {
    if (msg.params.context.name === "OpenFront Stats") contentCtxId = msg.params.context.id;
  }
};
ws.addEventListener("message", ctxHandler);
await send("Runtime.disable");
await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 500));
ws.removeEventListener("message", ctxHandler);

const result = await send("Runtime.evaluate", {
  contextId: contentCtxId,
  expression: `
    (function() {
      var store = globalThis.__ofStatsStore;
      var state = store.getState();
      var rec = state.liveRecord;

      // Simulate EXACTLY what useTimelineChart's timelineEvents memo does

      var GOLD_EVENT_TYPES_SET = new Set([
        "city","factory","port","silo","sam","warship","defensePost",
        "atomBomb","hydrogenBomb","mirv","upgrade","donation"
      ]);

      var ticks = rec.series.ticks;
      var tickToIdx = new Map();
      for (var i = 0; i < ticks.length; i++) tickToIdx.set(ticks[i], i);

      // We need shownPlayerIds and enabledEventTypes.
      // These come from the React component state. We can't access those directly.
      // But we know enabledEventTypes should include allianceFormed (it's on by default).
      // And shownPlayerIds should match record.players for nations.

      // Let's just simulate with ALL players shown and ALL event types enabled
      var allPlayerIds = new Set(Object.keys(rec.players).map(Number));

      var fromGoldEvents = 0;
      var fromTimelineEvents = 0;
      var fromTimelineByType = {};
      var skippedReasons = {};

      // goldEvents loop
      if (rec.goldEvents) {
        for (var i = 0; i < rec.goldEvents.length; i++) {
          var evt = rec.goldEvents[i];
          if (!allPlayerIds.has(evt.playerId)) { skippedReasons['gold:unknownPlayer'] = (skippedReasons['gold:unknownPlayer']||0)+1; continue; }
          var dataIdx = tickToIdx.get(evt.tick);
          if (dataIdx === undefined) { skippedReasons['gold:noTick'] = (skippedReasons['gold:noTick']||0)+1; continue; }
          fromGoldEvents++;
        }
      }

      // timelineEvents loop
      if (rec.timelineEvents) {
        for (var i = 0; i < rec.timelineEvents.length; i++) {
          var evt = rec.timelineEvents[i];
          // enabledEventTypes check - assume all enabled
          if (!allPlayerIds.has(evt.playerId)) { skippedReasons['tl:unknownPlayer:'+evt.eventType] = (skippedReasons['tl:unknownPlayer:'+evt.eventType]||0)+1; continue; }
          if (GOLD_EVENT_TYPES_SET.has(evt.eventType)) { skippedReasons['tl:isGoldType:'+evt.eventType] = (skippedReasons['tl:isGoldType:'+evt.eventType]||0)+1; continue; }
          var dataIdx = tickToIdx.get(evt.tick);
          if (dataIdx === undefined) { skippedReasons['tl:noTick:'+evt.eventType] = (skippedReasons['tl:noTick:'+evt.eventType]||0)+1; continue; }
          fromTimelineEvents++;
          fromTimelineByType[evt.eventType] = (fromTimelineByType[evt.eventType]||0)+1;
        }
      }

      return JSON.stringify({
        fromGoldEvents: fromGoldEvents,
        fromTimelineEvents: fromTimelineEvents,
        fromTimelineByType: fromTimelineByType,
        skippedReasons: skippedReasons,
        totalGoldEventsInRecord: rec.goldEvents.length,
        totalTimelineEventsInRecord: rec.timelineEvents.length,
      }, null, 2);
    })()
  `,
  returnByValue: true,
});

console.log(result.result?.value);
ws.close();
