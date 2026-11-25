// Check what timeline events the extension has actually collected.
// The page script communicates via CustomEvent "ofstats-data" to the content script.
// We can intercept future events and also check if there's any global store.
// Run via: npx tsx tools/cdp/eval.ts -f tools/cdp/scratch/debug-extension-state.js
(function() {
  var captured = [];

  // Listen for the extension's data events
  function handler(e) {
    var detail = e.detail;
    if (detail && detail.type === 'snapshot' && detail.timelineEvents) {
      captured.push({
        type: 'snapshot',
        tick: detail.tick,
        timelineEventCount: detail.timelineEvents.length,
        timelineEvents: detail.timelineEvents.slice(0, 10),
        goldEventCount: detail.goldEvents ? detail.goldEvents.length : 0,
      });
    } else if (detail) {
      captured.push({
        type: detail.type,
        tick: detail.tick,
        keys: Object.keys(detail),
      });
    }
  }

  window.addEventListener('ofstats-data', handler);

  return new Promise(function(resolve) {
    setTimeout(function() {
      window.removeEventListener('ofstats-data', handler);
      resolve(JSON.stringify({
        capturedEvents: captured.slice(0, 20),
        totalCaptured: captured.length,
      }, null, 2));
    }, 15000);
  });
})()
