// CDP scratch: compute viewport rect using captured transform with BOTH old and new formulas
// Also verify by checking game's own screenBoundingRect equivalent
(() => {
  const panel = document.querySelector("control-panel");
  const gv = panel?.game;

  const canvases = document.querySelectorAll("canvas");
  let gameCtx = null;
  let gameCanvas = null;
  for (const c of canvases) {
    if (c.style.zIndex === "99998") continue;
    const ctx = c.getContext("2d");
    if (ctx) { gameCtx = ctx; gameCanvas = c; break; }
  }

  const t = gameCtx._ofCaptured;
  if (!t || t.a === 0) return "No captured transform yet";

  const scale = t.a;
  const mapW = gv.width();  // 1528
  const mapH = gv.height(); // 1500
  const canvasW = gameCanvas.width;  // 2099
  const canvasH = gameCanvas.height; // 1054

  // === Correct derivation from game source (TransformHandler.screenBoundingRect) ===
  // setTransform(scale, 0, 0, scale, mapW/2 - offsetX*scale, mapH/2 - offsetY*scale)
  // So: t.e = mapW/2 - offsetX*scale → offsetX = (mapW/2 - t.e) / scale
  const offsetX = (mapW / 2 - t.e) / scale;
  const offsetY = (mapH / 2 - t.f) / scale;

  // From game's screenBoundingRect():
  //   LeftX = -gameWidth / (2*scale) + offsetX
  //   gameLeftX = LeftX + gameWidth/2
  //   RightX = (canvasWidth - gameWidth/2) / scale + offsetX
  //   gameRightX = RightX + gameWidth/2
  const LeftX = -mapW / (2 * scale) + offsetX;
  const TopY = -mapH / (2 * scale) + offsetY;
  const gameLeftX = LeftX + mapW / 2;
  const gameTopY = TopY + mapH / 2;
  const RightX = (canvasW - mapW / 2) / scale + offsetX;
  const BottomY = (canvasH - mapH / 2) / scale + offsetY;
  const gameRightX = RightX + mapW / 2;
  const gameBottomY = BottomY + mapH / 2;
  const gameViewW = gameRightX - gameLeftX; // = canvasW / scale
  const gameViewH = gameBottomY - gameTopY; // = canvasH / scale

  // Game's screenCenter:
  const gameCenterX = gameLeftX + (gameRightX - gameLeftX) / 2;
  const gameCenterY = gameTopY + (gameBottomY - gameTopY) / 2;

  // Normalized over [0, mapW] x [0, mapH]
  const correct_nx = Math.max(0, gameLeftX / mapW);
  const correct_ny = Math.max(0, gameTopY / mapH);
  const correct_nw = Math.min(1, gameRightX / mapW) - correct_nx;
  const correct_nh = Math.min(1, gameBottomY / mapH) - correct_ny;

  // === My "new code" (current viewport-overlay.ts) ===
  // tileLeft = -t.e / scale + mapW / 2
  const myTileLeft = -t.e / scale + mapW / 2;
  const myTileTop = -t.f / scale + mapH / 2;
  const myTileW = canvasW / scale;
  const myTileH = canvasH / scale;
  const my_nx = Math.max(0, myTileLeft / mapW);
  const my_ny = Math.max(0, myTileTop / mapH);
  const my_nw = Math.min(1, (myTileLeft + myTileW) / mapW) - my_nx;
  const my_nh = Math.min(1, (myTileTop + myTileH) / mapH) - my_ny;

  // === Verify: does myTileLeft === gameLeftX? ===
  // myTileLeft = -t.e / scale + mapW/2
  //            = -(mapW/2 - offsetX*scale) / scale + mapW/2
  //            = -mapW/(2*scale) + offsetX + mapW/2
  //            = offsetX + mapW/2 - mapW/(2*scale)
  // gameLeftX  = -mapW/(2*scale) + offsetX + mapW/2
  //            = offsetX + mapW/2 - mapW/(2*scale)
  // These ARE the same!

  // === Pan math check ===
  // My current panToPosition center:
  const myCenterX = (canvasW / 2 - t.e) / scale + mapW / 2;
  const myCenterY = (canvasH / 2 - t.f) / scale + mapH / 2;

  return JSON.stringify({
    transform: t,
    scale,
    mapDims: { mapW, mapH },
    canvasDims: { canvasW, canvasH },
    offsetXY: { offsetX, offsetY },
    gameRect: {
      gameLeftX, gameTopY, gameRightX, gameBottomY,
      gameViewW, gameViewH,
      gameCenterX, gameCenterY,
    },
    correct_normalized: { nx: correct_nx, ny: correct_ny, nw: correct_nw, nh: correct_nh },
    myCode_tileRect: { myTileLeft, myTileTop, myTileW, myTileH },
    myCode_normalized: { nx: my_nx, ny: my_ny, nw: my_nw, nh: my_nh },
    myCode_match: {
      leftMatch: Math.abs(myTileLeft - gameLeftX) < 0.001,
      topMatch: Math.abs(myTileTop - gameTopY) < 0.001,
    },
    panCenter: { myCenterX, myCenterY, gameCenterX, gameCenterY },
    panCenterMatch: {
      xMatch: Math.abs(myCenterX - gameCenterX) < 0.001,
      yMatch: Math.abs(myCenterY - gameCenterY) < 0.001,
    },
  }, null, 2);
})()
