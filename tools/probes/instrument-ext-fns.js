// Instrument individual extension functions to find what's expensive.
// The page script is bundled, so we can't access internal functions directly.
// Instead, we measure the cost of specific game API calls that our ext makes
// during the WITH-extension phase by wrapping them one at a time.
//
// Strategy: wrap config.maxTroops() and playerViews() since those are the
// remaining API calls in snapshotPlayers().
(() => {
  if (window.__ofFnTiming) return JSON.stringify({ status: 'already installed' });

  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  const config = gv.config();

  window.__ofFnTiming = {
    startTime: performance.now(),
    metrics: {},
  };

  function track(label) {
    const m = { calls: 0, totalMs: 0 };
    window.__ofFnTiming.metrics[label] = m;
    return m;
  }

  // config.maxTroops(player) - called once per player per snapshot
  const mMaxTroops = track('config.maxTroops()');
  const origMaxTroops = config.maxTroops.bind(config);
  config.maxTroops = function(player) {
    const t0 = performance.now();
    const result = origMaxTroops(player);
    mMaxTroops.totalMs += performance.now() - t0;
    mMaxTroops.calls++;
    return result;
  };

  // gv.playerViews() - called per snapshot
  const mPV = track('gv.playerViews()');
  const origPV = gv.playerViews.bind(gv);
  gv.playerViews = function() {
    const t0 = performance.now();
    const result = origPV();
    mPV.totalMs += performance.now() - t0;
    mPV.calls++;
    return result;
  };

  // gv.ticks()
  const mTicks = track('gv.ticks()');
  const origTicks = gv.ticks.bind(gv);
  gv.ticks = function() {
    const t0 = performance.now();
    const result = origTicks();
    mTicks.totalMs += performance.now() - t0;
    mTicks.calls++;
    return result;
  };

  // window.dispatchEvent for our custom event
  const mDispatch = track('dispatchEvent(ofstats-data)');
  const origDispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = function(event) {
    if (event.type === 'ofstats-data') {
      const t0 = performance.now();
      const result = origDispatch(event);
      mDispatch.totalMs += performance.now() - t0;
      mDispatch.calls++;
      return result;
    }
    return origDispatch(event);
  };

  // territoryColor() — wrap on player view objects
  const mColor = track('pv.territoryColor()');
  const origPV2 = gv.playerViews.bind(gv); // re-get since we wrapped
  // Actually we already wrapped playerViews. Let's wrap the results.
  const currentPV = gv.playerViews;
  gv.playerViews = function() {
    const players = currentPV.call(gv);
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.__colorWrapped) {
        const origColor = p.territoryColor.bind(p);
        p.territoryColor = function() {
          const t0 = performance.now();
          const result = origColor();
          mColor.totalMs += performance.now() - t0;
          mColor.calls++;
          return result;
        };
        p.__colorWrapped = true;
      }
    }
    return players;
  };

  // Store restorers
  window.__ofFnTiming._restore = () => {
    config.maxTroops = origMaxTroops;
    gv.playerViews = origPV;
    gv.ticks = origTicks;
    window.dispatchEvent = origDispatch;
  };

  return JSON.stringify({ status: 'installed' });
})()
