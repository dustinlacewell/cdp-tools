// Probe game state: unit count, player count, tick
(() => {
  const panel = document.querySelector('control-panel');
  const gv = panel && panel.game;
  if (!gv) return JSON.stringify({ error: 'no game view' });

  const units = gv.units();
  const players = gv.playerViews();
  const tick = gv.ticks();

  // Count alive players
  let alive = 0;
  for (let i = 0; i < players.length; i++) {
    if (players[i].isAlive()) alive++;
  }

  return JSON.stringify({
    tick,
    totalUnits: units.length,
    totalPlayers: players.length,
    alivePlayers: alive,
    heapMB: Math.round(performance.memory?.usedJSHeapSize / 1048576),
  });
})()
