// Debug why conquest/eliminated/alliance events are missing from the timeline.
// Run via: npx tsx tools/cdp/eval.ts -f tools/cdp/scratch/debug-missing-events.js
//
// Intercepts gv.update() for 30s and logs ALL non-empty update keys (except 0/1/2
// which are tile/unit/player bulk updates). Also dumps the full enum by checking
// every key 0-25 for data at least once.
(function() {
  var cp = document.querySelector('control-panel');
  var gv = cp && cp.game;
  if (!gv) return JSON.stringify({error: 'no game view'});

  var origUpdate = gv.update;
  var tickCount = 0;
  var keyHits = {};       // key -> {count, samples: []}
  var allKeysEverSeen = {};
  var startTime = Date.now();
  var DURATION_MS = 15000;

  gv.update = function(gu) {
    tickCount++;
    if (gu && gu.updates) {
      for (var k = 0; k <= 25; k++) {
        var arr = gu.updates[k];
        if (arr && arr.length > 0) {
          allKeysEverSeen[k] = (allKeysEverSeen[k] || 0) + arr.length;
          // Skip bulk keys (0=Tile, 1=Unit, 2=Player) for detailed logging
          if (k <= 2) continue;
          if (!keyHits[k]) keyHits[k] = {count: 0, samples: []};
          keyHits[k].count += arr.length;
          if (keyHits[k].samples.length < 3) {
            keyHits[k].samples.push({
              tick: tickCount,
              data: JSON.stringify(arr.slice(0, 2)).substring(0, 500)
            });
          }
        }
      }
    }
    return origUpdate.call(gv, gu);
  };

  return new Promise(function(resolve) {
    var interval = setInterval(function() {
      if (Date.now() - startTime > DURATION_MS) {
        clearInterval(interval);
        gv.update = origUpdate;
        resolve(JSON.stringify({
          durationMs: Date.now() - startTime,
          ticksObserved: tickCount,
          allKeysEverSeen: allKeysEverSeen,
          interestingKeyHits: keyHits,
        }, null, 2));
      }
    }, 500);
  });
})()
