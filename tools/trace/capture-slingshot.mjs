// Node 22+, a local Chrome installation, and the running slingshot site.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { gzipSync } from "node:zlib";

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => join(root, "Google", "Chrome", "Application", "chrome.exe")),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  const path = candidates.find(path => path && existsSync(path));
  if (!path) throw new Error("Set CHROME_PATH to the Chrome or Chromium executable.");
  return path;
}

async function waitFor(label, operation, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await operation();
    if (value) return value;
    await sleep(80);
  }
  throw new Error("Timed out waiting for " + label);
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await once(socket, "open", { signal: AbortSignal.timeout(10000) });
  let id = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const callback = message.id ? pending.get(message.id) : events.get(message.method);
    if (callback) callback(message);
  });
  socket.addEventListener("close", () => {
    for (const callback of [...pending.values(), ...events.values()]) {
      callback({ error: { message: "Chrome disconnected" } });
    }
  });
  function response(key, map, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        map.delete(key);
        reject(new Error("Timed out waiting for " + label));
      }, 60000);
      map.set(key, message => {
        clearTimeout(timer);
        map.delete(key);
        if (message.error) reject(new Error(label + ": " + message.error.message));
        else resolve(message.result ?? message.params);
      });
    });
  }
  return {
    socket,
    send(method, params = {}) {
      const request = ++id;
      const result = response(request, pending, method);
      socket.send(JSON.stringify({ id: request, method, params }));
      return result;
    },
    event(method) { return response(method, events, method); },
  };
}

const categories = [
  "-*", "toplevel", "blink.user_timing", "devtools.timeline", "v8",
  "disabled-by-default-v8.cpu_profiler", "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame", "cc", "viz", "benchmark", "gpu",
];

async function capture(url, output) {
  const profile = await mkdtemp(join(tmpdir(), "trace-query-chrome-"));
  let chrome, client, exited, partial;
  try {
    chrome = spawn(chromePath(), [
      "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
      "--disable-background-networking", "--disable-extensions", "--no-first-run",
      "--disable-default-apps", "--no-default-browser-check", "--window-size=1100,800",
      "--force-device-scale-factor=1", "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    exited = once(chrome, "exit");
    const port = await waitFor("Chrome's local debugging port", async () => {
      if (chrome.exitCode !== null) throw new Error("Chrome exited during startup.");
      try { return (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    });
    const tabs = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    client = await connect(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
    const { send } = client;
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.enable");
    const navigation = await send("Page.navigate", { url: url.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    await waitFor("the game ready state", () => evaluate("document.body?.dataset.state === 'ready' && !!document.querySelector('svg#field, #launch')"));
    const pull = await evaluate(`(() => {
      const field = document.querySelector("svg#field");
      if (!field) return null;
      field.scrollIntoView({ block: "center", behavior: "instant" });
      const transform = field.getScreenCTM();
      const point = (x, y) => {
        const client = new DOMPoint(x, y).matrixTransform(transform);
        return { x: client.x, y: client.y };
      };
      return [point(154.8, 284.4), point(82.146, 323.025)];
    })()`);
    const browser = await send("Browser.getVersion");
    await send("Tracing.start", { categories: categories.join(","), transferMode: "ReturnAsStream", streamFormat: "json" });
    // Measure from release until the game records the completed shot. The
    // observer doesn't add a polling callback to each animation frame.
    await evaluate(`(() => {
      const event = ${JSON.stringify(pull ? "pointerup" : "click")};
      window.captureFinished = new Promise((resolve, reject) => {
        document.addEventListener(event, () => {
          const start = performance.now();
          const observer = new MutationObserver(() => {
            if (!window.shotResult) return;
            clearTimeout(timeout);
            observer.disconnect();
            resolve({ shotElapsedMs: performance.now() - start, result: window.shotResult });
          });
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error("Shot did not finish."));
          }, 45000);
          observer.observe(document.body, { attributes: true, attributeFilter: ["data-state"] });
        }, { capture: true, once: true });
      });
    })()`);
    if (pull) {
      const [anchor, release] = pull;
      const mouse = (type, point, buttons, button = "none") =>
        send("Input.dispatchMouseEvent", { type, ...point, button, buttons, clickCount: 1 });
      await mouse("mouseMoved", anchor, 0);
      await mouse("mousePressed", anchor, 1, "left");
      await mouse("mouseMoved", release, 1);
      await mouse("mouseReleased", release, 0, "left");
    } else {
      await evaluate("document.querySelector('#launch').click()");
    }
    const { shotElapsedMs, result } = await evaluate("window.captureFinished");
    const complete = client.event("Tracing.tracingComplete");
    await send("Tracing.end");
    const { stream, dataLossOccurred } = await complete;
    if (dataLossOccurred) throw new Error("Chrome reported trace data loss.");
    const chunks = [];
    for (;;) {
      const chunk = await send("IO.read", { handle: stream, size: 1048576 });
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
      if (chunk.eof) break;
    }
    await send("IO.close", { handle: stream });
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    // Chrome's global metadata includes the browser command line, profile path
    // and host hardware details. Analysis needs only event and thread records.
    const traceEvents = raw.traceEvents.filter(e => e.ph !== "M" || ["thread_name", "process_name"].includes(e.name));
    const report = { metadata: { browser: browser.product, viewport: [1100, 800] }, traceEvents };
    const bytes = gzipSync(JSON.stringify(report), { level: 9 });
    await mkdir(dirname(output), { recursive: true });
    partial = output + "." + process.pid + ".partial";
    await writeFile(partial, bytes, { flag: "wx" });
    await rename(partial, output);
    partial = undefined;
    console.log(JSON.stringify({ output, browser: browser.product, traceEvents: traceEvents.length, bytes: bytes.length, shotElapsedMs, result }));
  } finally {
    if (partial) await rm(partial, { force: true });
    if (client?.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify({ id: 99999999, method: "Browser.close" }));
      client.socket.close();
    }
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      let timer;
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
      clearTimeout(timer);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await exited; }
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

try {
  const [address, path, ...extra] = process.argv.slice(2);
  if (!address || !path?.endsWith(".json.gz") || extra.length)
    throw new Error("Usage: node scripts/capture-slingshot.mjs LOCAL_GAME_URL output.json.gz");
  const url = new URL(address);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol))
    throw new Error("Use the local development server's URL.");
  await capture(url, resolve(path));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
