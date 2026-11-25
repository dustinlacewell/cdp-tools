// Instrument the page-script hot path to measure per-tick cost.
// Patches gv.update to time our gameLoop overhead vs the game's own update.
(() => {
  if (window.__ofPerfInstrumented) return JSON.stringify({ status: 'already instrumented' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  // Storage for timing samples
  window.__ofPerf = {
    samples: [],       // { gameMs, extMs, tick, unitCount }
    maxSamples: 2000,
    startTime: Date.now(),
  };

  // Unwrap our existing patch to find the original update
  // The current gv.update is: (gu) => { origUpdate(gu); gameLoop(gu); }
  // We need to re-wrap it to time both halves.
  const currentUpdate = gv.update.bind(gv);

  // We'll time the entire current update (which includes orig + our gameLoop)
  // and also time just the game API calls we make.
  let tickCounter = 0;

  gv.update = function(gu) {
    const t0 = performance.now();
    currentUpdate(gu);
    const t1 = performance.now();

    const totalMs = t1 - t0;

    // Sample every tick
    tickCounter++;
    const perf = window.__ofPerf;
    if (perf.samples.length < perf.maxSamples) {
      perf.samples.push({
        totalMs: Math.round(totalMs * 1000) / 1000,
        tick: tickCounter,
        ts: performance.now(),
      });
    }
  };

  window.__ofPerfInstrumented = true;
  return JSON.stringify({ status: 'instrumented', tick: gv.ticks() });
})()
