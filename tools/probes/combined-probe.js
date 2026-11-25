JSON.stringify({
  heap: Math.round(performance.memory?.usedJSHeapSize / 1048576),
  total: Math.round(performance.memory?.totalJSHeapSize / 1048576),
  ...JSON.parse(document.querySelector('#ofstats-root')?.dataset?.dbg || '{}'),
  timing: JSON.parse(document.querySelector('#ofstats-root')?.dataset?.timing || 'null'),
})