// Measure the size of gu.updates arrays per tick to understand
// how much data processEventUpdates is iterating.
(() => {
  if (window.__ofGuSize) return JSON.stringify({ status: 'already installed' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  window.__ofGuSize = {
    startTime: performance.now(),
    samples: [],
    maxSamples: 200,
  };

  const currentUpdate = gv.update;
  gv.update = function(gu) {
    const s = window.__ofGuSize;
    if (s && s.samples.length < s.maxSamples && gu && gu.updates) {
      const entry = {};
      let totalItems = 0;
      for (const key of Object.keys(gu.updates)) {
        const arr = gu.updates[key];
        const len = Array.isArray(arr) ? arr.length : 0;
        entry[key] = len;
        totalItems += len;
      }
      entry._total = totalItems;
      entry._packedTiles = gu.packedTileUpdates ? gu.packedTileUpdates.length / 2 : 0;
      s.samples.push(entry);
    }
    return currentUpdate.call(gv, gu);
  };

  window.__ofGuSize._restore = () => { gv.update = currentUpdate; };
  return JSON.stringify({ status: 'installed' });
})()
