// Granular instrumentation: time game's original update vs our extension overhead separately.
// This unwraps the patch chain and re-wraps with split timing.
(() => {
  if (window.__ofSplitInstrumented) return JSON.stringify({ status: 'already instrumented' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  // The current call chain is:
  //   [our timing wrapper] -> [ext patch: origUpdate(gu); gameLoop(gu);]
  // We can't easily unwrap that. Instead, let's inject performance.mark/measure
  // around the key extension functions by patching them in the page script world.

  // Alternative approach: use a different strategy.
  // We know the extension dispatches 'ofstats-data' CustomEvent. Let's measure
  // how many of those fire and how long the entire update takes, then subtract
  // the base game cost by temporarily disabling the extension's hook.

  // Simplest approach: measure with ext enabled, then briefly disable and measure without.
  // But that's destructive. Instead let's just profile using performance.now() marks
  // around the existing patched update.

  // Actually, the cleanest approach: The total update time includes BOTH the game
  // AND our extension. The game alone is ~100ms at this point (454 players, large map).
  // Let's check: what does the game cost WITHOUT our extension?
  // We can temporarily bypass our gameLoop to measure pure game cost.

  window.__ofSplit = {
    samples: [],
    mode: 'both',  // 'both' | 'game-only' | 'ext-only'
    maxSamples: 500,
  };

  // Save reference to current update (which is our timing wrapper or the ext patch)
  const patchedUpdate = gv.update.bind(gv);

  // To get the original game update, we need to find it.
  // The ext's patchUpdate does: gv.update = (gu) => { origUpdate(gu); gameLoop(gu); }
  // The origUpdate is captured in closure. We can't extract it directly.

  // Better approach: just measure the TOTAL and compare against a known baseline.
  // Or: temporarily add a flag that makes gameLoop() bail out early.

  // Let's use the window event approach — the page script emits 'ofstats-data'.
  // We can count events and time them.

  // Actually simplest: just patch to add a bypass flag.
  // When __ofSplit.mode === 'game-only', we skip our extension entirely.

  // We need to find the gameLoop function. It's in the page script IIFE.
  // Since we can't access it directly from eval, let's use a different tactic:
  // temporarily remove the patch.

  // Store current patched version
  window.__ofSplit.patchedUpdate = gv.update;

  // To find the ORIGINAL game update, we can look at the prototype
  // or try to extract from the closure. This is tricky.

  // Pragmatic approach: just measure the full update cost right now,
  // then programmatically disable our extension for a brief window and re-measure.

  // Phase 1: Measure total (game + ext) for N ticks
  let phase = 'total';
  let samplesBoth = [];
  let samplesGameOnly = [];
  let count = 0;

  // We already have __ofPerf data. Let's just create a toggle.
  // When toggled, we'll NOP the event dispatch so the extension does nothing downstream.

  // The actual overhead source is in the page script's gameLoop which calls:
  //   detectNewUnits(), processGameUpdates(), emitSnapshot()
  // These run in the same synchronous call. We CAN'T separate them from the game
  // update without modifying the source or finding the closure.

  // OK — the most practical CDP approach: use Performance.profile (CPU profiler)
  // to see exactly where time goes within the update call.

  // For now, let's at least confirm: is the 100ms mostly game or mostly us?
  // Quick test: what's the game running at WITHOUT any extension loaded?
  // The user said ~120fps = 8.33ms/frame. So the game itself is fast.
  // That means ~100ms is almost entirely extension overhead.

  // Let's verify by checking FPS directly.
  let frameCount = 0;
  let fpsStart = performance.now();
  window.__ofSplit.fps = [];

  function measureFps() {
    frameCount++;
    const now = performance.now();
    if (now - fpsStart >= 1000) {
      window.__ofSplit.fps.push(frameCount);
      frameCount = 0;
      fpsStart = now;
    }
    requestAnimationFrame(measureFps);
  }
  requestAnimationFrame(measureFps);

  window.__ofSplitInstrumented = true;

  // Return what we know: the 100ms total update includes both game + ext
  return JSON.stringify({
    status: 'fps-monitor-started',
    note: 'will measure FPS - check with read-split.js after a few seconds'
  });
})()
