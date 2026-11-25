import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { type Session } from "./session.ts";

export async function navigate(session: Session, url: string, timeout: number) {
  new URL(url);
  await session.send("Page.enable");
  await session.send("Page.setLifecycleEventsEnabled", { enabled: true });
  const loaded = new Set<string>();
  const off = session.on("Page.lifecycleEvent", event => {
    if (event.name === "load") loaded.add(String(event.loaderId));
  });
  try {
    const deadline = Date.now() + timeout;
    const nav = await session.send("Page.navigate", { url }, timeout) as {
      loaderId?: string; errorText?: string; isDownload?: boolean;
    };
    if (nav.errorText || nav.isDownload) throw new Error(nav.errorText || "URL started a download");
    while (nav.loaderId && !loaded.has(nav.loaderId)) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for page load: ${url}`);
      await sleep(40);
    }
  } finally {
    off();
  }
}

type Box = { x: number; y: number; width: number; height: number; clickX: number; clickY: number };

async function element(session: Session, selector: string, timeout: number, action: "wait" | "click" | "capture") {
  const expression = `(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    if (${action !== "wait"}) e.scrollIntoView({block: "center", inline: "center", behavior: "instant"});
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility !== "visible") return null;
    const clickX = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
    const clickY = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
    if (${action === "click"} && (e.matches(":disabled") || !e.contains(document.elementFromPoint(clickX, clickY)))) return null;
    return {x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, clickX, clickY};
  })()`;
  const deadline = Date.now() + timeout;
  do {
    const reply = await session.send("Runtime.evaluate", { expression, returnByValue: true },
      Math.max(1, deadline - Date.now())) as {
      result: { value?: Box }; exceptionDetails?: { exception?: { description?: string }; text: string };
    };
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    if (reply.result.value) return reply.result.value;
    await sleep(Math.min(80, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(`Timed out after ${timeout}ms waiting to ${action}: ${selector}`);
}

export const waitFor = (session: Session, selector: string, timeout: number) => element(session, selector, timeout, "wait");

export async function click(session: Session, selector: string, timeout: number) {
  const box = await element(session, selector, timeout, "click");
  for (const type of ["mousePressed", "mouseReleased"]) {
    await session.send("Input.dispatchMouseEvent", { type, x: box.clickX, y: box.clickY, button: "left", clickCount: 1 });
  }
}

export async function screenshot(session: Session, file: string, selector?: string, full = false, timeout = 10000) {
  let clip;
  if (selector !== undefined) {
    const { x, y, width, height } = await element(session, selector, timeout, "capture");
    clip = { x, y, width, height, scale: 1 };
  } else if (full) {
    const metrics = await session.send("Page.getLayoutMetrics") as { cssContentSize: { x: number; y: number; width: number; height: number } };
    clip = { ...metrics.cssContentSize, scale: 1 };
  }
  const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(clip), clip }, timeout) as { data: string };
  await writeFile(file, Buffer.from(shot.data, "base64"));
}
