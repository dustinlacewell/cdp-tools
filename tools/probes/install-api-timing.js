// Install wrappers around key game API calls to measure their cost.
// Run read-api-timing.js after ~10 seconds to collect results.
(() => {
  if (window.__ofApiTiming) return JSON.stringify({ status: 'already installed' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  window.__ofApiTiming = {
    startTime: performance.now(),
    metrics: {},
  };

  function wrapMethod(obj, name, label) {
    const orig = obj[name].bind(obj);
    const m = { calls: 0, totalMs: 0 };
    window.__ofApiTiming.metrics[label] = m;
    obj[name] = function() {
      const t0 = performance.now();
      const result = orig.apply(this, arguments);
      m.totalMs += performance.now() - t0;
      m.calls++;
      return result;
    };
    // Store restore function
    m._restore = () => { obj[name] = orig; };
  }

  wrapMethod(gv, 'units', 'gv.units()');
  wrapMethod(gv, 'playerViews', 'gv.playerViews()');
  wrapMethod(gv, 'ticks', 'gv.ticks()');
  wrapMethod(gv, 'numLandTiles', 'gv.numLandTiles()');

  // Wrap dispatchEvent for our custom event
  const origDispatch = window.dispatchEvent.bind(window);
  const em = { calls: 0, totalMs: 0 };
  window.__ofApiTiming.metrics['dispatchEvent(ofstats-data)'] = em;
  window.dispatchEvent = function(event) {
    if (event.type === 'ofstats-data') {
      const t0 = performance.now();
      const result = origDispatch(event);
      em.totalMs += performance.now() - t0;
      em.calls++;
      return result;
    }
    return origDispatch(event);
  };
  em._restore = () => { window.dispatchEvent = origDispatch; };

  return JSON.stringify({ status: 'installed', tick: gv.ticks() });
})()
