// Read timing samples and compute stats
(() => {
  const perf = window.__ofPerf;
  if (!perf) return JSON.stringify({ error: 'not instrumented' });

  const samples = perf.samples;
  if (samples.length === 0) return JSON.stringify({ error: 'no samples yet' });

  const totals = samples.map(s => s.totalMs);

  // Sort for percentiles
  const sorted = [...totals].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const max = sorted[sorted.length - 1];
  const min = sorted[0];
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;

  // Time span of samples
  const firstTs = samples[0].ts;
  const lastTs = samples[samples.length - 1].ts;
  const durationSec = (lastTs - firstTs) / 1000;

  // How many ticks exceeded budget (8.33ms = 120fps)
  const over8ms = totals.filter(t => t > 8.33).length;
  const over16ms = totals.filter(t => t > 16.67).length;

  return JSON.stringify({
    sampleCount: samples.length,
    durationSec: Math.round(durationSec * 10) / 10,
    ticksPerSec: Math.round(samples.length / durationSec * 10) / 10,
    avgMs: Math.round(avg * 1000) / 1000,
    p50Ms: p50,
    p90Ms: p90,
    p95Ms: p95,
    p99Ms: p99,
    minMs: min,
    maxMs: max,
    over8ms,
    over16ms,
    pctOver8ms: Math.round(over8ms / samples.length * 1000) / 10,
    pctOver16ms: Math.round(over16ms / samples.length * 1000) / 10,
  });
})()
