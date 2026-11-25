JSON.stringify({
  hasExt: !!document.querySelector('openfront-stats'),
  heapMB: Math.round(performance.memory?.usedJSHeapSize / 1048576),
  totalMB: Math.round(performance.memory?.totalJSHeapSize / 1048576),
  url: location.href,
})