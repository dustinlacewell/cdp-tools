// A/B test: measure update time WITH extension vs WITHOUT extension.
// Phase A: measure total (game + ext) for N calls
// Phase B: bypass ext (game only) for N calls
// Then restore and report the difference.
(async () => {
  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  const SAMPLE_COUNT = 200;

  // --- Phase A: measure with extension (current patched update) ---
  const patchedUpdate = gv.update;
  const samplesA = [];

  await new Promise(resolve => {
    gv.update = function(gu) {
      const t0 = performance.now();
      patchedUpdate.call(gv, gu);
      samplesA.push(performance.now() - t0);
      if (samplesA.length >= SAMPLE_COUNT) {
        gv.update = patchedUpdate; // restore while we process
        resolve();
      }
    };
  });

  // --- Extract the original game update from the patch chain ---
  // Our ext does: gv.update = (gu) => { origUpdate(gu); gameLoop(gu); }
  // The origUpdate is bound in closure. We can't extract it directly.
  // BUT: we can find it by temporarily replacing gameLoop's entry point.
  //
  // Alternative approach: call the game's prototype method directly.
  // The game object's constructor prototype should have the unpatched update.
  const proto = Object.getPrototypeOf(gv);
  const origUpdate = proto.update ? proto.update.bind(gv) : null;

  if (!origUpdate) {
    // Fallback: can't find prototype method, report what we have
    const avgA = samplesA.reduce((a, b) => a + b, 0) / samplesA.length;
    return JSON.stringify({
      error: 'could not find prototype update',
      withExt: { avgMs: Math.round(avgA * 1000) / 1000, samples: samplesA.length },
      note: 'only measured with-extension timing'
    });
  }

  // --- Phase B: measure game-only (bypass our extension) ---
  const samplesB = [];

  await new Promise(resolve => {
    gv.update = function(gu) {
      const t0 = performance.now();
      origUpdate(gu);
      samplesB.push(performance.now() - t0);
      if (samplesB.length >= SAMPLE_COUNT) {
        resolve();
      }
    };
  });

  // --- Restore the patched version ---
  gv.update = patchedUpdate;

  // --- Compute stats ---
  function stats(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      samples: arr.length,
      avgMs: Math.round(sum / arr.length * 1000) / 1000,
      p50Ms: Math.round(sorted[Math.floor(arr.length * 0.5)] * 1000) / 1000,
      p90Ms: Math.round(sorted[Math.floor(arr.length * 0.9)] * 1000) / 1000,
      p95Ms: Math.round(sorted[Math.floor(arr.length * 0.95)] * 1000) / 1000,
      maxMs: Math.round(sorted[arr.length - 1] * 1000) / 1000,
    };
  }

  const a = stats(samplesA);
  const b = stats(samplesB);

  return JSON.stringify({
    withExtension: a,
    gameOnly: b,
    extensionOverhead: {
      avgMs: Math.round((a.avgMs - b.avgMs) * 1000) / 1000,
      p50Ms: Math.round((a.p50Ms - b.p50Ms) * 1000) / 1000,
      p90Ms: Math.round((a.p90Ms - b.p90Ms) * 1000) / 1000,
    },
  }, null, 2);
})()
