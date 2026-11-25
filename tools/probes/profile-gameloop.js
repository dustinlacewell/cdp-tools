// Profile the gameLoop's major paths.
// Install pattern: run once, collects N samples, returns results.
//
// gameLoop (per tick) calls:
//   1. processEventUpdates(gu, tick)  — event-state.ts
//   2. processGameUpdates(gu)         — timeline.ts
//   3. emitSnapshot()                 — snapshot.ts (which calls snapshotPlayers + emit)
//
// We patch gv.update to time each piece by temporarily replacing the
// extension's patched update with our own instrumented version.
//
// Since we can't access the module functions directly, we TIME the whole
// patched update call vs the game-only prototype call, giving us total ext cost.
// Then we separately wrap the known API calls made DURING the ext code to
// attribute time to snapshot vs event processing.
//
// Key insight: the ext patch is: origUpdate(gu); gameLoop(gu);
// gameLoop calls: processEventUpdates, processGameUpdates, then emitSnapshot.
// emitSnapshot calls: gv.playerViews(), gv.ticks(), gv.config(), config.maxTroops(pv),
//   pv.territoryColor(), pv.smallID(), pv.gold(), pv.displayName(), etc.
//   then dispatchEvent('ofstats-data').
//
// So: time spent in API calls during snapshot = snapshot cost.
// Everything else after game update = event processing + object building.

(async () => {
  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  const SAMPLES = 60;
  const patchedUpdate = gv.update;
  const protoUpdate = Object.getPrototypeOf(gv).update;

  if (!protoUpdate) return JSON.stringify({ error: 'no proto update' });

  // We'll collect per-tick timing
  const ticks = [];

  // Wrap APIs called during emitSnapshot to measure snapshot time
  const config = gv.config();

  // --- Wrap config.maxTroops ---
  const origMaxTroops = config.maxTroops.bind(config);
  let maxTroopsMs = 0, maxTroopsCalls = 0;
  config.maxTroops = function(p) {
    const t = performance.now();
    const r = origMaxTroops(p);
    maxTroopsMs += performance.now() - t;
    maxTroopsCalls++;
    return r;
  };

  // --- Wrap playerViews ---
  const origPV = gv.playerViews.bind(gv);
  let playerViewsMs = 0;
  gv.playerViews = function() {
    const t = performance.now();
    const r = origPV();
    playerViewsMs += performance.now() - t;
    return r;
  };

  // --- Wrap dispatchEvent for ofstats-data ---
  const origDispatch = window.dispatchEvent.bind(window);
  let dispatchMs = 0;
  window.dispatchEvent = function(event) {
    if (event.type === 'ofstats-data') {
      const t = performance.now();
      const r = origDispatch(event);
      dispatchMs += performance.now() - t;
      return r;
    }
    return origDispatch(event);
  };

  // --- Wrap territoryColor (called per player in snapshot) ---
  // Can't wrap this globally since it's on each playerView instance.
  // We'll wrap it by patching the prototype of a playerView.
  let territoryColorMs = 0;
  let pvProtoPatched = false;

  await new Promise(resolve => {
    gv.update = function(gu) {
      // Reset per-tick accumulators
      maxTroopsMs = 0; maxTroopsCalls = 0;
      playerViewsMs = 0;
      dispatchMs = 0;
      territoryColorMs = 0;

      // Patch territoryColor on playerView prototype (once)
      if (!pvProtoPatched) {
        const pvs = origPV();
        if (pvs.length > 0) {
          const pvProto = Object.getPrototypeOf(pvs[0]);
          if (pvProto.territoryColor) {
            const origTC = pvProto.territoryColor;
            pvProto.territoryColor = function() {
              const t = performance.now();
              const r = origTC.call(this);
              territoryColorMs += performance.now() - t;
              return r;
            };
            pvProtoPatched = pvProto;
          }
        }
      }

      // Time game-only update
      const g0 = performance.now();
      protoUpdate.call(gv, gu);
      const gameMs = performance.now() - g0;

      // Time full patched update (game + extension)
      const f0 = performance.now();
      patchedUpdate.call(gv, gu);
      const fullMs = performance.now() - f0;

      // Extension total = full - game (approximately, game runs twice but should be consistent)
      const extMs = fullMs - gameMs;

      // Snapshot API cost = maxTroops + playerViews + dispatch + territoryColor
      const snapshotApiMs = maxTroopsMs + playerViewsMs + dispatchMs + territoryColorMs;

      // Event processing + snapshot object building = ext - snapshotApi
      const eventProcMs = Math.max(0, extMs - snapshotApiMs);

      ticks.push({
        gameMs,
        fullMs,
        extMs: Math.max(0, extMs),
        maxTroopsMs,
        maxTroopsCalls,
        playerViewsMs,
        dispatchMs,
        territoryColorMs,
        snapshotApiMs,
        eventProcMs,
      });

      if (ticks.length >= SAMPLES) {
        // Restore everything
        gv.update = patchedUpdate;
        config.maxTroops = origMaxTroops;
        gv.playerViews = origPV;
        window.dispatchEvent = origDispatch;
        if (pvProtoPatched) {
          // Can't easily restore proto - leave it, it's thin wrapper
        }
        resolve();
      }
    };
  });

  // Stats
  function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function p90(arr) {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.9)];
  }
  function fmt(v) { return Math.round(v * 1000) / 1000; }

  const keys = ['gameMs', 'fullMs', 'extMs', 'maxTroopsMs', 'playerViewsMs',
    'dispatchMs', 'territoryColorMs', 'snapshotApiMs', 'eventProcMs'];

  const out = { samples: ticks.length, avg: {}, p90: {} };
  for (const k of keys) {
    const vals = ticks.map(t => t[k]);
    out.avg[k] = fmt(avg(vals));
    out.p90[k] = fmt(p90(vals));
  }
  out.avg.maxTroopsCalls = Math.round(avg(ticks.map(t => t.maxTroopsCalls)));

  return JSON.stringify(out, null, 2);
})()
