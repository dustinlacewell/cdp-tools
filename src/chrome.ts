import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { openSession } from "./session.ts";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === "win32"
    ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
        .filter(Boolean).map(dir => join(dir!, "Google", "Chrome", "Application", "chrome.exe"))
    : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome",
        "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find(path => existsSync(path)) ?? "google-chrome";
}

export async function withChrome(run: (base: string, exited: Promise<void>) => Promise<void>) {
  const profile = await mkdtemp(join(tmpdir(), "cdp-chrome-"));
  const child = spawn(chromePath(), ["--headless", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
  let launchError: Error | undefined;
  child.on("error", error => { launchError = error; });
  const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
  let interrupt!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => reject(new Error("Browser run interrupted"));
  });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let socketUrl: string | undefined;
  try {
    const start = Date.now();
    while (!socketUrl) {
      if (launchError) throw new Error(`Cannot start Chrome. Set CHROME_PATH to its executable. ${launchError.message}`);
      if (child.exitCode !== null || child.signalCode) throw new Error("Chrome exited during startup");
      if (Date.now() - start > 15_000) throw new Error("Chrome did not expose its debugging port within 15s");
      const info = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
      const [port, path] = info.trim().split(/\r?\n/);
      if (port && /^\d+$/.test(port) && path?.startsWith("/devtools/browser/")) {
        socketUrl = `ws://127.0.0.1:${port}${path}`;
        await Promise.race([run(`http://127.0.0.1:${port}`, exited), interrupted]);
      } else {
        await Promise.race([sleep(50), interrupted]);
      }
    }
  } finally {
    try {
      if (child.pid && child.exitCode === null && !child.signalCode) {
        if (socketUrl) {
          const session = await openSession(socketUrl).catch(() => undefined);
          if (session) {
            await session.send("Browser.close", {}, 2000).catch(() => {});
            session.close();
          }
        }
        if (!socketUrl || !(await Promise.race([exited.then(() => true), sleep(2000, false, { ref: false })]))) child.kill("SIGKILL");
      }
      await exited;
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
}
