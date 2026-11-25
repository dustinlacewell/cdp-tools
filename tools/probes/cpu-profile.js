// Start a V8 CPU profile for N seconds, then return a summary of top functions.
// This runs entirely in-page so we get function-level breakdown.
(async () => {
  // Use the built-in console.profile / console.profileEnd is not accessible.
  // Instead, use performance.mark + measure around known hot spots.

  // Better: use the User Timing API to measure specific things.
  // Let's measure the REAL cost by wrapping the key game API calls.

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  // Wrap gv.units() to measure its cost
  const origUnits = gv.units.bind(gv);
  let unitsCallCount = 0;
  let unitsTotalMs = 0;
  gv.units = function() {
    const t0 = performance.now();
    const result = origUnits();
    unitsTotalMs += performance.now() - t0;
    unitsCallCount++;
    return result;
  };

  // Wrap gv.playerViews()
  const origPlayerViews = gv.playerViews.bind(gv);
  let pvCallCount = 0;
  let pvTotalMs = 0;
  gv.playerViews = function() {
    const t0 = performance.now();
    const result = origPlayerViews();
    pvTotalMs += performance.now() - t0;
    pvCallCount++;
    return result;
  };

  // Wrap gv.ticks()
  const origTicks = gv.ticks.bind(gv);
  let ticksCallCount = 0;
  let ticksTotalMs = 0;
  gv.ticks = function() {
    const t0 = performance.now();
    const result = origTicks();
    ticksTotalMs += performance.now() - t0;
    ticksCallCount++;
    return result;
  };

  // Measure the CustomEvent dispatch cost
  let eventCount = 0;
  let eventTotalMs = 0;
  const origDispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = function(event) {
    if (event.type === 'ofstats-data') {
      const t0 = performance.now();
      const result = origDispatch(event);
      eventTotalMs += performance.now() - t0;
      eventCount++;
      return result;
    }
    return origDispatch(event);
  };

  // Let it collect for 10 seconds
  await new Promise(r => setTimeout(r, 10000));

  // Restore originals
  gv.units = origUnits;
  gv.playerViews = origPlayerViews;
  gv.ticks = origTicks;
  window.dispatchEvent = origDispatch;

  return JSON.stringify({
    durationSec: 10,
    'gv.units()': { calls: unitsCallCount, totalMs: Math.round(unitsTotalMs * 100) / 100, avgMs: Math.round(unitsTotalMs / Math.max(unitsCallCount, 1) * 1000) / 1000 },
    'gv.playerViews()': { calls: pvCallCount, totalMs: Math.round(pvTotalMs * 100) / 100, avgMs: Math.round(pvTotalMs / Math.max(pvCallCount, 1) * 1000) / 1000 },
    'gv.ticks()': { calls: ticksCallCount, totalMs: Math.round(ticksTotalMs * 100) / 100, avgMs: Math.round(ticksTotalMs / Math.max(ticksCallCount, 1) * 1000) / 1000 },
    'dispatchEvent(ofstats-data)': { calls: eventCount, totalMs: Math.round(eventTotalMs * 100) / 100, avgMs: Math.round(eventTotalMs / Math.max(eventCount, 1) * 1000) / 1000 },
  });
})()
