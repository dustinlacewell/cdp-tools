// CDP scratch: dump all transform + canvas values needed for viewport math
(() => {
  // Find game canvas (2D, no zIndex 99998)
  const canvases = document.querySelectorAll("canvas");
  let gameCanvas = null;
  let gameCtx = null;
  for (const c of canvases) {
    if (c.style.zIndex === "99998") continue;
    const ctx = c.getContext("2d");
    if (ctx) { gameCanvas = c; gameCtx = ctx; break; }
  }
  if (!gameCanvas || !gameCtx) return "No game canvas found";

  const t = gameCtx.getTransform();

  // Get map dimensions from game view
  const panel = document.querySelector("control-panel");
  const gv = panel?.game;
  const mapW = gv?.width?.() ?? "?";
  const mapH = gv?.height?.() ?? "?";

  // Canvas dimensions
  const canvasW = gameCanvas.width;
  const canvasH = gameCanvas.height;
  const bcr = gameCanvas.getBoundingClientRect();

  // Transform components
  const scale = t.a;

  // Derived values (our current code)
  const tileLeft = -t.e / scale + mapW / 2;
  const tileTop = -t.f / scale + mapH / 2;
  const tileW = canvasW / scale;
  const tileH = canvasH / scale;

  // Viewport center
  const centerX = (canvasW / 2 - t.e) / scale + mapW / 2;
  const centerY = (canvasH / 2 - t.f) / scale + mapH / 2;

  // Old code's computation for comparison
  const offsetX = (mapW / 2 - t.e) / scale;
  const offsetY = (mapH / 2 - t.f) / scale;
  const old_viewW = bcr.width / scale;
  const old_viewH = bcr.height / scale;
  const old_x0 = offsetX - old_viewW / 2;
  const old_y0 = offsetY - old_viewH / 2;

  // Normalized rects
  const nx = Math.max(0, tileLeft / mapW);
  const ny = Math.max(0, tileTop / mapH);
  const nw = Math.min(1, (tileLeft + tileW) / mapW) - nx;
  const nh = Math.min(1, (tileTop + tileH) / mapH) - ny;

  return JSON.stringify({
    mapDims: { mapW, mapH },
    canvasDims: { canvasW, canvasH, bcrW: bcr.width, bcrH: bcr.height },
    transform: { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f },
    scale,
    newCode: {
      tileLeft, tileTop, tileW, tileH,
      centerX, centerY,
      normalized: { nx, ny, nw, nh },
    },
    oldCode: {
      offsetX, offsetY,
      viewW: old_viewW, viewH: old_viewH,
      x0: old_x0, y0: old_y0,
    },
    dpr: window.devicePixelRatio,
  }, null, 2);
})()
