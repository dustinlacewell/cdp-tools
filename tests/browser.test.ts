import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { withChrome } from "../src/chrome.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("capture through the CLI in both launched and attached Chrome", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cdp-test-"));
  try {
    const page = join(dir, "fixture.html");
    await writeFile(page, `<!doctype html><title>Fixture</title><style>
      body{margin:0;width:1400px;height:2000px} #result{width:123px;height:45px;background:green;margin-top:900px}
      </style><button onclick="if(event.isTrusted)setTimeout(()=>result.hidden=false,150)">Show</button>
      <div id="result" hidden></div>`);
    const url = pathToFileURL(page).href;
    const shot = join(dir, "shot.png");
    async function dimensions() {
      const png = await readFile(shot);
      assert.equal(png.toString("ascii", 1, 4), "PNG");
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    }
    await exec(process.execPath, ["src/browser.ts", "screenshot", shot, "--launch", "--url", url,
      "--click", "button", "--wait", "#result", "--element", "#result"], { cwd: root });
    assert.deepEqual(await dimensions(), [123, 45]);
    await withChrome(async base => {
      const env = { ...process.env, CDP_HOST: "127.0.0.1", CDP_PORT: new URL(base).port };
      const cli = (...args: string[]) => exec(process.execPath, args, { env, cwd: root });
      await cli("src/browser.ts", "goto", url);
      await cli("src/browser.ts", "click", "button", "--page", "Fixture");
      await cli("src/browser.ts", "wait", "#result");
      await cli("src/screenshot.ts", shot, "Fixture");
      const [width, height] = await dimensions();
      assert.ok(width > 0 && height > 0 && height < 2000);
      await cli("src/browser.ts", "screenshot", shot, "--full-page");
      assert.deepEqual(await dimensions(), [1400, 2000]);
      await assert.rejects(cli("src/browser.ts", "click", "button", "--page", "missing-tab"), /No page found/);
      await assert.rejects(cli("src/browser.ts", "wait", "#absent", "--timeout", "250"), /Timed out/);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

