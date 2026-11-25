// Remove any lingering timing wrappers
(() => {
  const cleaned = [];

  if (window.__ofApiTiming) {
    for (const [label, m] of Object.entries(window.__ofApiTiming.metrics)) {
      if (m._restore) { m._restore(); cleaned.push(label); }
    }
    delete window.__ofApiTiming;
  }
  if (window.__ofDeepTiming) {
    if (window.__ofDeepTiming._restoreUnits) { window.__ofDeepTiming._restoreUnits(); cleaned.push('deep-units'); }
    if (window.__ofDeepTiming._restorePV) { window.__ofDeepTiming._restorePV(); cleaned.push('deep-pv'); }
    delete window.__ofDeepTiming;
  }
  if (window.__ofLoopTiming) {
    delete window.__ofLoopTiming;
    cleaned.push('loop-timing');
  }
  if (window.__ofPerf) {
    delete window.__ofPerf;
    cleaned.push('perf');
  }
  if (window.__ofPerfInstrumented) {
    delete window.__ofPerfInstrumented;
    cleaned.push('perf-instrumented');
  }

  return JSON.stringify({ cleaned });
})()
