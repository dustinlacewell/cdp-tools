// Read gu.updates size stats
(() => {
  const s = window.__ofGuSize;
  if (!s) return JSON.stringify({ error: 'not installed' });

  const samples = s.samples;
  if (samples.length === 0) return JSON.stringify({ error: 'no samples' });

  // Aggregate stats per key
  const keyStats = {};
  const totals = [];
  const tileTotals = [];

  for (const entry of samples) {
    totals.push(entry._total);
    tileTotals.push(entry._packedTiles);
    for (const [key, val] of Object.entries(entry)) {
      if (key.startsWith('_')) continue;
      if (!keyStats[key]) keyStats[key] = { sum: 0, count: 0, max: 0 };
      keyStats[key].sum += val;
      keyStats[key].count++;
      if (val > keyStats[key].max) keyStats[key].max = val;
    }
  }

  const result = {
    sampleCount: samples.length,
    totalItemsPerUpdate: {
      avg: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
      max: Math.max(...totals),
    },
    packedTilesPerUpdate: {
      avg: Math.round(tileTotals.reduce((a, b) => a + b, 0) / tileTotals.length),
      max: Math.max(...tileTotals),
    },
    byUpdateKey: {},
  };

  for (const [key, stats] of Object.entries(keyStats)) {
    result.byUpdateKey[key] = {
      avgItems: Math.round(stats.sum / stats.count * 10) / 10,
      maxItems: stats.max,
    };
  }

  if (s._restore) s._restore();
  delete window.__ofGuSize;

  return JSON.stringify(result, null, 2);
})()
