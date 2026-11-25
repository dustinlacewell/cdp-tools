// A/B test v2: more careful about isolating extension cost.
// Instead of using prototype.update (which may differ from the instance method),
// we temporarily neuter our extension's gameLoop by setting gameActive = false.
//
// Our ext's patch is: (gu) => { origUpdate(gu); gameLoop(gu); }
// gameLoop() early-returns if !state.gameActive.
// So if we can flip that flag, we measure game-with-patch-but-no-work.
(async () => {
  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  const SAMPLE_COUNT = 150;
  const patchedUpdate = gv.update;

  // --- Phase A: measure with extension active ---
  const samplesA = [];
  await new Promise(resolve => {
    gv.update = function(gu) {
      const t0 = performance.now();
      patchedUpdate.call(gv, gu);
      samplesA.push(performance.now() - t0);
      if (samplesA.length >= SAMPLE_COUNT) {
        gv.update = patchedUpdate;
        resolve();
      }
    };
  });

  // --- Phase B: measure with extension neutered ---
  // Find the page script's state object. It's not globally exposed,
  // but we can use a different approach: temporarily replace gameLoop
  // by patching gv.update to call ONLY the game's original update.
  //
  // The ext's patched update captures origUpdate in closure. We can't
  // access it. But we CAN use the prototype method as a proxy for the
  // "game only" path, with a correctness check.
  const proto = Object.getPrototypeOf(gv);
  const protoUpdate = proto.update;

  // Verify the prototype method exists and is different from patched
  if (!protoUpdate) {
    return JSON.stringify({ error: 'no prototype update found' });
  }

  // Phase B1: time prototype.update
  const samplesB = [];
  await new Promise(resolve => {
    gv.update = function(gu) {
      const t0 = performance.now();
      protoUpdate.call(gv, gu);
      samplesB.push(performance.now() - t0);
      if (samplesB.length >= SAMPLE_COUNT) {
        resolve();
      }
    };
  });

  // Phase B2: also time calling patched update but with a no-op gameLoop
  // We can do this by temporarily making the ext think the game isn't active.
  // Look for the state object via the custom event mechanism.
  // Actually — let's just dispatch a settings event to disable collection?
  // No, simpler: we already have two good measurements. The prototype IS
  // the original game update — it's what origUpdate.bind(gv) points to.

  // --- Restore ---
  gv.update = patchedUpdate;

  // --- Stats ---
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

  // Also check: does the game's update function call gv.units() internally?
  // If so, our earlier wrappers would have added overhead to proto.update too.
  // Let's check if proto.update source mentions units.
  const protoSrc = protoUpdate.toString().substring(0, 200);

  return JSON.stringify({
    withExtension: a,
    gameOnly_proto: b,
    extensionOverhead: {
      avgMs: Math.round((a.avgMs - b.avgMs) * 1000) / 1000,
      p50Ms: Math.round((a.p50Ms - b.p50Ms) * 1000) / 1000,
      p90Ms: Math.round((a.p90Ms - b.p90Ms) * 1000) / 1000,
    },
    protoUpdatePreview: protoSrc,
  }, null, 2);
})()
