// Inspect timeline events at runtime.
// Run via: npx tsx tools/cdp/eval.ts -f tools/cdp/scratch/debug-timeline.js
(function() {
  var cp = document.querySelector('control-panel');
  var gv = cp && cp.game;
  if (!gv) return JSON.stringify({error: 'no game view'});

  // Intercept the next few update() calls and check for alliance/win/etc
  var origUpdate = gv.update;
  var ticks = 0;
  var found = [];

  gv.update = function(gu) {
    ticks++;
    if (gu && gu.updates) {
      // Check keys 5-12 (alliance request through win)
      for (var k = 5; k <= 20; k++) {
        var arr = gu.updates[k];
        if (arr && arr.length > 0) {
          found.push({tick: ticks, key: k, count: arr.length, first: JSON.stringify(arr[0]).substring(0, 200)});
        }
      }
    }
    return origUpdate.call(gv, gu);
  };

  return new Promise(function(resolve) {
    setTimeout(function() {
      gv.update = origUpdate;
      resolve(JSON.stringify({
        ticksObserved: ticks,
        nonEmptyUpdates: found.slice(0, 20)
      }, null, 2));
    }, 5000);
  });
})()
