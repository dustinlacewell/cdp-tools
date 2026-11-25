// Read gameloop timing stats
(() => {
  const lt = window.__ofLoopTiming;
  if (!lt) return JSON.stringify({ error: 'not installed' });

  const samples = lt.samples;
  if (samples.length === 0) return JSON.stringify({ error: 'no samples' });

  const elapsed = (performance.now() - lt.startTime) / 1000;
  const sorted = [...samples].sort((a, b) => a - b);

  const sum = samples.reduce((a, b) => a + b, 0);
  const avg = sum / samples.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const max = sorted[sorted.length - 1];
  const min = sorted[0];

  const over8ms = samples.filter(t => t > 8.33).length;
  const over16ms = samples.filter(t => t > 16.67).length;

  // Don't clean up — allow re-reading
  return JSON.stringify({
    sampleCount: samples.length,
    durationSec: Math.round(elapsed * 10) / 10,
    updatesPerSec: Math.round(samples.length / elapsed * 10) / 10,
    avgMs: Math.round(avg * 1000) / 1000,
    p50Ms: Math.round(p50 * 1000) / 1000,
    p90Ms: Math.round(p90 * 1000) / 1000,
    p95Ms: Math.round(p95 * 1000) / 1000,
    p99Ms: Math.round(p99 * 1000) / 1000,
    minMs: Math.round(min * 1000) / 1000,
    maxMs: Math.round(max * 1000) / 1000,
    over8ms,
    over16ms,
    pctOver8ms: Math.round(over8ms / samples.length * 1000) / 10,
    pctOver16ms: Math.round(over16ms / samples.length * 1000) / 10,
    totalCpuMs: Math.round(sum),
    cpuPct: Math.round(sum / (elapsed * 1000) * 1000) / 10,
  });
})()
