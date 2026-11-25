// Time individual parts of gameLoop.
// We can't access internal functions, but we CAN measure the gap between
// known API calls. Our extension's per-tick work is:
//   1. processEventUpdates(gu, tick) — iterates UnitUpdate[] + PlayerUpdate[]
//   2. processGameUpdates(gu) — iterates timeline events
//   3. emitSnapshot() — builds SnapshotPlayer[], dispatches CustomEvent
//      which internally calls: config.maxTroops() per player, territoryColor(), etc.
//
// Strategy: wrap gv.update to time the TOTAL ext overhead (total - proto),
// and wrap the API calls made during snapshots to carve out their cost.
// Whatever remains is event processing + snapshot object building.
(async () => {
  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  const SAMPLES = 100;
  const patchedUpdate = gv.update;
  const protoUpdate = Object.getPrototypeOf(gv).update;

  // Per-tick accumulators (reset each tick)
  let tickDispatchMs = 0;
  let tickMaxTroopsMs = 0;
  let tickPlayerViewsMs = 0;

  // Wrap dispatchEvent
  const origDispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = function(event) {
    if (event.type === 'ofstats-data') {
      const t0 = performance.now();
      const r = origDispatch(event);
      tickDispatchMs += performance.now() - t0;
      return r;
    }
    return origDispatch(event);
  };

  // Wrap config.maxTroops
  const config = gv.config();
  const origMT = config.maxTroops.bind(config);
  config.maxTroops = function(p) {
    const t0 = performance.now();
    const r = origMT(p);
    tickMaxTroopsMs += performance.now() - t0;
    return r;
  };

  // Wrap playerViews
  const origPV = gv.playerViews.bind(gv);
  gv.playerViews = function() {
    const t0 = performance.now();
    const r = origPV();
    tickPlayerViewsMs += performance.now() - t0;
    return r;
  };

  const results = [];

  await new Promise(resolve => {
    gv.update = function(gu) {
      // Reset per-tick accumulators
      tickDispatchMs = 0;
      tickMaxTroopsMs = 0;
      tickPlayerViewsMs = 0;

      // Time the full patched update (game + ext)
      const t0 = performance.now();
      patchedUpdate.call(gv, gu);
      const totalMs = performance.now() - t0;

      // We can't easily time game-only here without double-calling.
      // Use a fixed estimate from our A/B: game ~0.6ms
      const extMs = totalMs - 0.6;
      const snapshotApiMs = tickDispatchMs + tickMaxTroopsMs + tickPlayerViewsMs;
      const restMs = extMs - snapshotApiMs;

      results.push({
        totalMs,
        extMs: Math.max(0, extMs),
        dispatchMs: tickDispatchMs,
        maxTroopsMs: tickMaxTroopsMs,
        playerViewsMs: tickPlayerViewsMs,
        snapshotApiMs,
        eventProcAndBuildMs: Math.max(0, restMs),
      });

      if (results.length >= SAMPLES) {
        gv.update = patchedUpdate;
        window.dispatchEvent = origDispatch;
        config.maxTroops = origMT;
        gv.playerViews = origPV;
        resolve();
      }
    };
  });

  function avg(key) {
    return Math.round(results.reduce((s, r) => s + r[key], 0) / results.length * 1000) / 1000;
  }
  function p90fn(key) {
    const sorted = results.map(r => r[key]).sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length * 0.9)] * 1000) / 1000;
  }

  const keys = ['totalMs', 'extMs', 'dispatchMs', 'maxTroopsMs', 'playerViewsMs', 'snapshotApiMs', 'eventProcAndBuildMs'];
  const out = { samples: results.length, avg: {}, p90: {} };
  for (const k of keys) { out.avg[k] = avg(k); out.p90[k] = p90fn(k); }

  return JSON.stringify(out, null, 2);
})()
