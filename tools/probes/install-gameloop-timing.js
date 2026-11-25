// Measure the cost of our extension's gameLoop by timing the overhead
// added on top of the game's original update call.
// This patches gv.update to time: total update vs game-only update.
(() => {
  if (window.__ofLoopTiming) return JSON.stringify({ status: 'already installed' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  window.__ofLoopTiming = {
    startTime: performance.now(),
    samples: [],
    maxSamples: 3000,
  };

  // The current gv.update chain is:
  //   our ext patch: (gu) => { origGameUpdate(gu); gameLoop(gu); }
  // We wrap the whole thing to time total, and also time just origGameUpdate.
  // Since we can't access origGameUpdate directly, we time the full call
  // and that gives us total frame cost including our extension.

  const currentUpdate = gv.update;

  gv.update = function(gu) {
    const t0 = performance.now();
    currentUpdate.call(gv, gu);
    const totalMs = performance.now() - t0;

    const lt = window.__ofLoopTiming;
    if (lt && lt.samples.length < lt.maxSamples) {
      lt.samples.push(totalMs);
    }
  };

  return JSON.stringify({ status: 'installed', tick: gv.ticks() });
})()
