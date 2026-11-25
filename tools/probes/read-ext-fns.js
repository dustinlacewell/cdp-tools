// Read extension function timing
(() => {
  const t = window.__ofFnTiming;
  if (!t) return JSON.stringify({ error: 'not installed' });

  const elapsed = (performance.now() - t.startTime) / 1000;
  const result = { durationSec: Math.round(elapsed * 10) / 10 };

  let totalTracked = 0;
  for (const [label, m] of Object.entries(t.metrics)) {
    result[label] = {
      calls: m.calls,
      totalMs: Math.round(m.totalMs * 10) / 10,
      avgMs: Math.round(m.totalMs / Math.max(m.calls, 1) * 1000) / 1000,
      callsPerSec: Math.round(m.calls / elapsed * 10) / 10,
    };
    totalTracked += m.totalMs;
  }
  result.totalTrackedMs = Math.round(totalTracked);
  result.totalTrackedPct = Math.round(totalTracked / (elapsed * 1000) * 1000) / 10;

  // Restore
  if (t._restore) t._restore();
  delete window.__ofFnTiming;

  return JSON.stringify(result, null, 2);
})()
