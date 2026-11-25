// Capture key 19 (ConquestEvent) data specifically.
// Run via: npx tsx tools/cdp/eval.ts -f tools/cdp/scratch/debug-key19.js
(function() {
  var cp = document.querySelector('control-panel');
  var gv = cp && cp.game;
  if (!gv) return JSON.stringify({error: 'no game view'});

  var origUpdate = gv.update;
  var tickCount = 0;
  var key19Samples = [];
  var startTime = Date.now();

  gv.update = function(gu) {
    tickCount++;
    if (gu && gu.updates) {
      // Capture key 19 (ConquestEvent in source)
      var arr19 = gu.updates[19];
      if (arr19 && arr19.length > 0) {
        for (var i = 0; i < arr19.length && key19Samples.length < 10; i++) {
          key19Samples.push({
            tick: tickCount,
            gameTick: gv.ticks(),
            data: JSON.parse(JSON.stringify(arr19[i]))
          });
        }
      }
    }
    return origUpdate.call(gv, gu);
  };

  return new Promise(function(resolve) {
    var interval = setInterval(function() {
      if (Date.now() - startTime > 20000) {
        clearInterval(interval);
        gv.update = origUpdate;
        resolve(JSON.stringify({
          ticksObserved: tickCount,
          key19Count: key19Samples.length,
          key19Samples: key19Samples,
        }, null, 2));
      }
    }, 500);
  });
})()
