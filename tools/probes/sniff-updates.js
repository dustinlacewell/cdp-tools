// Sniff ALL GameUpdate keys the game sends over N seconds.
// This reveals what event types exist that we might not be using.
(() => {
  if (window.__ofSniff) return JSON.stringify({ status: 'already running' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  window.__ofSniff = {
    startTime: performance.now(),
    // key -> { count, samplePayloads: [...first 3 payloads] }
    updateKeys: {},
    tickCount: 0,
    emptyTicks: 0,
  };

  // Wrap gv.update to intercept the raw GameUpdates
  const currentUpdate = gv.update.bind(gv);
  gv.update = function(gu) {
    const sniff = window.__ofSniff;
    sniff.tickCount++;

    if (gu && gu.updates) {
      const keys = Object.keys(gu.updates);
      if (keys.length === 0) sniff.emptyTicks++;

      for (const key of keys) {
        const arr = gu.updates[key];
        if (!sniff.updateKeys[key]) {
          sniff.updateKeys[key] = {
            count: 0,
            totalItems: 0,
            samplePayloads: [],
          };
        }
        const entry = sniff.updateKeys[key];
        entry.count++;
        entry.totalItems += Array.isArray(arr) ? arr.length : 0;

        // Capture first 3 sample payloads for inspection
        if (entry.samplePayloads.length < 3 && Array.isArray(arr) && arr.length > 0) {
          try {
            // Deep-copy first item, converting BigInt to string
            const sample = JSON.parse(JSON.stringify(arr[0], (k, v) =>
              typeof v === 'bigint' ? v.toString() + 'n' : v
            ));
            entry.samplePayloads.push(sample);
          } catch(e) {
            entry.samplePayloads.push({ error: e.message });
          }
        }
      }
    } else {
      sniff.emptyTicks++;
    }

    return currentUpdate(gu);
  };

  window.__ofSniff._restore = () => { gv.update = currentUpdate; };
  return JSON.stringify({ status: 'sniffing', tick: gv.ticks() });
})()
