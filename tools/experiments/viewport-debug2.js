// CDP scratch: check if the game uses save/restore, and try to find the transform handler
(() => {
  const panel = document.querySelector("control-panel");
  const gv = panel?.game;

  // Try to find the GameRenderer and its TransformHandler
  // GameRenderer is typically created with the canvas
  // Let's look at what properties exist on the panel
  const panelKeys = Object.keys(panel ?? {});

  // Check if there's a renderer or transformHandler accessible
  let rendererKeys = [];
  let transformInfo = null;

  // Look for GameRenderer - it might be on the game view or panel
  for (const key of panelKeys) {
    const val = panel[key];
    if (val && typeof val === "object") {
      const subKeys = Object.keys(val);
      if (subKeys.includes("transformHandler") || subKeys.includes("canvas")) {
        rendererKeys.push({ key, subKeys: subKeys.slice(0, 20) });
      }
    }
  }

  // Try gv (GameView) keys
  const gvKeys = gv ? Object.getOwnPropertyNames(Object.getPrototypeOf(gv)).filter(k => !k.startsWith("_")) : [];

  // Check for renderer on gv
  let gvRendererInfo = null;
  if (gv) {
    for (const key of Object.keys(gv)) {
      const val = gv[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const subKeys = Object.keys(val);
        if (subKeys.includes("transformHandler") || subKeys.includes("canvas") || subKeys.includes("scale")) {
          gvRendererInfo = { key, subKeys: subKeys.slice(0, 30) };
        }
      }
    }
  }

  // Try to find it via eventBus - the TransformHandler registers on DragEvent
  const eb = panel?.eventBus;
  let dragEventCls = null;
  let dragListeners = [];
  if (eb?.listeners instanceof Map) {
    for (const [cls, cbs] of eb.listeners) {
      const s = String(cls);
      if (s.includes("deltaX") && s.includes("deltaY")) {
        dragEventCls = s.slice(0, 200);
        // The listener callback might have the TransformHandler as `this`
        dragListeners = cbs.map(cb => String(cb).slice(0, 200));
      }
    }
  }

  // Try to find TransformHandler by walking the eventBus listener callbacks
  // The DragEvent listener is `(e) => this.onMove(e)` bound to TransformHandler
  let thInfo = null;
  if (eb?.listeners instanceof Map) {
    for (const [cls, cbs] of eb.listeners) {
      const s = String(cls);
      if (s.includes("deltaX") && s.includes("deltaY")) {
        for (const cb of cbs) {
          // Try to inspect the bound function
          if (typeof cb === "function") {
            // Arrow functions created in constructor capture `this` in closure
            // We can't easily get it. But let's check if it's a bound function
            const cbStr = String(cb);
            thInfo = { cbStr: cbStr.slice(0, 300) };
          }
        }
      }
    }
  }

  return JSON.stringify({
    panelKeys,
    rendererKeys,
    gvRendererInfo,
    dragEventCls,
    dragListeners,
    thInfo,
  }, null, 2);
})()
