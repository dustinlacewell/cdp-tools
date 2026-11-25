// CDP scratch: intercept setTransform to capture the actual values
// Also try to find TransformHandler via the DragEvent listener closure
(() => {
  const panel = document.querySelector("control-panel");
  const eb = panel?.eventBus;

  // Strategy 1: Monkey-patch setTransform on the game canvas context to capture values
  const canvases = document.querySelectorAll("canvas");
  let gameCanvas = null;
  let gameCtx = null;
  for (const c of canvases) {
    if (c.style.zIndex === "99998") continue;
    const ctx = c.getContext("2d");
    if (ctx) { gameCanvas = c; gameCtx = ctx; break; }
  }

  if (!gameCtx) return "No game canvas";

  // Intercept setTransform to capture the last values
  if (!gameCtx._ofCaptured) {
    const orig = gameCtx.setTransform.bind(gameCtx);
    gameCtx._ofCaptured = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
    gameCtx.setTransform = function(a, b, c, d, e, f) {
      if (typeof a === "number") {
        gameCtx._ofCaptured = { a, b, c, d, e, f };
      }
      return orig(a, b, c, d, e, f);
    };
  }

  // Strategy 2: Try to find TransformHandler by emitting a probe DragEvent
  // and checking if we can find its scale/offset by looking at the listener
  let thScale = null;
  let thOffsetX = null;
  let thOffsetY = null;

  // The DragEvent listener is "n=>this.onMove(n)" - "this" is the TransformHandler
  // Let's try to find it via the Map entries
  if (eb?.listeners instanceof Map) {
    for (const [cls, cbs] of eb.listeners) {
      const s = String(cls);
      if (s.includes("deltaX") && s.includes("deltaY")) {
        for (const cb of cbs) {
          // Try to read properties from the closure scope
          // We can't directly, but we can try a different approach:
          // Look for ZoomEvent listener which also has TransformHandler
          break;
        }
      }
      // Check for ZoomEvent - it also has TH as listener
      if (s.includes("delta") && !s.includes("deltaX") && s.includes("x") && s.includes("y")) {
        // ZoomEvent: class{constructor(delta, x, y)}
      }
    }

    // List ALL event types and their listener strings
    const allListeners = {};
    for (const [cls, cbs] of eb.listeners) {
      const s = String(cls).slice(0, 100);
      allListeners[s] = cbs.map(cb => String(cb).slice(0, 200));
    }

    return JSON.stringify({
      captured: gameCtx._ofCaptured,
      note: "Run again after a frame to get captured transform values",
      allListeners,
    }, null, 2);
  }

  return JSON.stringify({ captured: gameCtx._ofCaptured });
})()
