// Read collected API timing data and clean up.
(() => {
  const t = window.__ofApiTiming;
  if (!t) return JSON.stringify({ error: 'not installed' });

  const elapsed = (performance.now() - t.startTime) / 1000;
  const result = { durationSec: Math.round(elapsed * 10) / 10 };

  for (const [label, m] of Object.entries(t.metrics)) {
    result[label] = {
      calls: m.calls,
      totalMs: Math.round(m.totalMs * 100) / 100,
      avgMs: Math.round(m.totalMs / Math.max(m.calls, 1) * 1000) / 1000,
      callsPerSec: Math.round(m.calls / elapsed * 10) / 10,
    };
    // Restore original
    if (m._restore) m._restore();
  }

  delete window.__ofApiTiming;
  return JSON.stringify(result, null, 2);
})()
