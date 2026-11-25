// CDP scratch: read captured transform (after interceptor was installed in debug3)
// Also try to find TransformHandler via a callback that references it
(() => {
  const panel = document.querySelector("control-panel");
  const eb = panel?.eventBus;

  // Read captured transform
  const canvases = document.querySelectorAll("canvas");
  let gameCtx = null;
  for (const c of canvases) {
    if (c.style.zIndex === "99998") continue;
    const ctx = c.getContext("2d");
    if (ctx) { gameCtx = ctx; break; }
  }

  const captured = gameCtx?._ofCaptured ?? "no interceptor";

  // Strategy: Find TransformHandler by looking at MoveWarshipEvent listener
  // which has "this.transformHandler" in its body
  let th = null;
  if (eb?.listeners instanceof Map) {
    for (const [cls, cbs] of eb.listeners) {
      const s = String(cls);
      // MoveWarshipEvent references this.transformHandler
      if (s.includes("unitId") && s.includes("tile") && !s.includes("unitType")) {
        for (const cb of cbs) {
          const cbStr = String(cb);
          if (cbStr.includes("transformHandler")) {
            // This callback is bound to a layer that has a `transformHandler` property
            // We can't access closure vars from CDP, but we know it exists
            // Let's try another approach: find the GameRenderer
          }
        }
      }
    }
  }

  // Strategy: The Redraw event "class Ip{}" has listener "()=>this.redraw()"
  // which is bound to GameRenderer. GameRenderer has transformHandler.
  // We can try to find it by looking at ALL objects reachable from panel

  // Actually, let's just use the intercepted setTransform values
  // and also check what game.width() and game.height() return
  const gv = panel?.game;
  const mapW = gv?.width?.();
  const mapH = gv?.height?.();

  return JSON.stringify({
    captured,
    mapW,
    mapH,
    canvasW: gameCtx?.canvas?.width,
    canvasH: gameCtx?.canvas?.height,
  }, null, 2);
})()
