// Deeper instrumentation: trace WHERE gv.units() calls come from,
// and also measure player.units(type) calls from countUnits.
(() => {
  if (window.__ofDeepTiming) return JSON.stringify({ status: 'already installed' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  window.__ofDeepTiming = {
    startTime: performance.now(),
    gvUnits: { calls: 0, totalMs: 0 },
    // Track call stacks to see WHO is calling gv.units()
    callerSample: {},  // caller string -> count
    sampleEvery: 100,  // sample stack every N calls
  };

  // Wrap gv.units() with caller tracking
  const origUnits = gv.units.bind(gv);
  gv.units = function() {
    const t = window.__ofDeepTiming;
    const t0 = performance.now();
    const result = origUnits();
    t.gvUnits.totalMs += performance.now() - t0;
    t.gvUnits.calls++;

    // Sample call stacks periodically
    if (t.gvUnits.calls % t.sampleEvery === 0) {
      try {
        const stack = new Error().stack;
        // Get just the caller line (2nd frame)
        const lines = stack.split('\n');
        const caller = (lines[2] || '').trim().substring(0, 120);
        t.callerSample[caller] = (t.callerSample[caller] || 0) + 1;
      } catch(e) {}
    }

    return result;
  };
  window.__ofDeepTiming._restoreUnits = () => { gv.units = origUnits; };

  // Also wrap player.units() by patching the prototype or playerViews result
  // We need to intercept the player objects. Let's wrap playerViews to patch players.
  window.__ofDeepTiming.playerUnits = { calls: 0, totalMs: 0, byType: {} };
  const origPV = gv.playerViews.bind(gv);
  gv.playerViews = function() {
    const players = origPV();
    // Wrap each player's .units() method if not already wrapped
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.__unitWrapped) {
        const origPUnits = p.units.bind(p);
        p.units = function(type) {
          const pu = window.__ofDeepTiming.playerUnits;
          const t0 = performance.now();
          const result = origPUnits(type);
          const elapsed = performance.now() - t0;
          pu.totalMs += elapsed;
          pu.calls++;
          if (type) {
            if (!pu.byType[type]) pu.byType[type] = { calls: 0, totalMs: 0 };
            pu.byType[type].calls++;
            pu.byType[type].totalMs += elapsed;
          }
          return result;
        };
        p.__unitWrapped = true;
      }
    }
    return players;
  };
  window.__ofDeepTiming._restorePV = () => { gv.playerViews = origPV; };

  return JSON.stringify({ status: 'installed' });
})()
