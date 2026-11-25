// Dump every update key seen, with types and data shape.
// Run via: npx tsx tools/cdp/eval.ts -f tools/cdp/scratch/debug-all-keys.js
(function() {
  var cp = document.querySelector('control-panel');
  var gv = cp && cp.game;
  if (!gv) return JSON.stringify({error: 'no game view'});

  var origUpdate = gv.update;
  var tickCount = 0;
  var keyInfo = {};
  var startTime = Date.now();

  gv.update = function(gu) {
    tickCount++;
    if (gu && gu.updates) {
      var keys = Object.keys(gu.updates);
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        var val = gu.updates[k];
        if (!keyInfo[k]) {
          keyInfo[k] = {
            firstTick: tickCount,
            totalItems: 0,
            nonEmptyTicks: 0,
            emptyTicks: 0,
            type: typeof val,
            isArray: Array.isArray(val),
            samples: []
          };
        }
        var info = keyInfo[k];
        if (Array.isArray(val)) {
          if (val.length > 0) {
            info.nonEmptyTicks++;
            info.totalItems += val.length;
            if (info.samples.length < 2) {
              try {
                info.samples.push(JSON.parse(JSON.stringify(val[0])));
              } catch(e) {
                info.samples.push(String(val[0]).substring(0, 200));
              }
            }
          } else {
            info.emptyTicks++;
          }
        } else {
          info.nonEmptyTicks++;
          if (info.samples.length < 2) {
            info.samples.push(String(val).substring(0, 200));
          }
        }
      }
    }
    return origUpdate.call(gv, gu);
  };

  return new Promise(function(resolve) {
    setTimeout(function() {
      gv.update = origUpdate;

      // Also check what the extension's GameUpdateType enum maps to
      var enumCheck = {
        note: "local source enum: ConquestEvent=19, EmbargoEvent=20, RailroadSnapEvent=18",
        key18_is: keyInfo["18"] ? "RailroadSnapEvent data" : "no data",
        key19_is: keyInfo["19"] ? "ConquestEvent data" : "no data",
        key20_is: keyInfo["20"] ? "data present" : "no data",
      };

      resolve(JSON.stringify({
        ticksObserved: tickCount,
        keys: keyInfo,
        enumCheck: enumCheck,
      }, null, 2));
    }, 15000);
  });
})()
