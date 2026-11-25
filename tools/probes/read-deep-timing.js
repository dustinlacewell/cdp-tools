// Read deep timing data
(() => {
  const t = window.__ofDeepTiming;
  if (!t) return JSON.stringify({ error: 'not installed' });

  const elapsed = (performance.now() - t.startTime) / 1000;

  const result = {
    durationSec: Math.round(elapsed * 10) / 10,
    'gv.units()': {
      calls: t.gvUnits.calls,
      totalMs: Math.round(t.gvUnits.totalMs),
      callsPerSec: Math.round(t.gvUnits.calls / elapsed),
      callerSamples: t.callerSample,
    },
    'player.units(type)': {
      calls: t.playerUnits.calls,
      totalMs: Math.round(t.playerUnits.totalMs),
      callsPerSec: Math.round(t.playerUnits.calls / elapsed),
      byType: {},
    },
  };

  for (const [type, m] of Object.entries(t.playerUnits.byType)) {
    result['player.units(type)'].byType[type] = {
      calls: m.calls,
      totalMs: Math.round(m.totalMs * 100) / 100,
    };
  }

  // Restore
  if (t._restoreUnits) t._restoreUnits();
  if (t._restorePV) t._restorePV();
  delete window.__ofDeepTiming;

  return JSON.stringify(result, null, 2);
})()
