// Probe extension internals via __OPENFRONT_STATS__ or window events
// The content script exposes state via CustomEvents
(() => {
  // Try to find the extension's React root in the shadow DOM div
  const shadowHosts = [...document.querySelectorAll('*')].filter(e => e.shadowRoot);
  const divHost = shadowHosts.find(e => e.tagName === 'DIV');
  const shadowChildren = divHost ? divHost.shadowRoot.children.length : 0;

  // Check for page-script state (injected into main world)
  const hasPageScript = typeof window.__OPENFRONT_STATS_STATE__ !== 'undefined';

  // Check for pending snapshots via CustomEvent mechanism
  // The page script dispatches 'openfront-snapshot' events

  return JSON.stringify({
    shadowHost: !!divHost,
    shadowChildren,
    hasPageScript,
    heapMB: Math.round(performance.memory?.usedJSHeapSize / 1048576),
  });
})()