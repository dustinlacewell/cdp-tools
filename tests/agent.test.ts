import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { withChrome } from "../src/chrome.ts";

const exec = promisify(execFile);
const call = (...args: string[]) =>
  exec(process.execPath, ["src/agent.ts", ...args]);
test("agent commands expose version, schema, and machine-readable validation errors", async () => {
  assert.equal(JSON.parse((await call("version")).stdout).version, "1.1.0");
  assert.equal(
    JSON.parse((await call("schema")).stdout).additionalProperties,
    false,
  );
  await assert.rejects(
    call("bad-command"),
    (e: any) =>
      e.code === 2 && JSON.parse(e.stdout).error.code === "INVALID_INPUT",
  );
});

test("recipe captures isolated variants, diagnostics, CPU, performance, accessible controls, PDFs and heap growth", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/broken") {
      res.writeHead(503).end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <button aria-label="Run" onclick="window.items=Array.from({length:1200},()=>new RetainedExample()); document.body.className='done'">Run</button><button></button>
      <script>class RetainedExample{}; fetch('/broken'); console.error('fixture error');
      document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';</script>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const dir = await mkdtemp(join(tmpdir(), "cdp-agent-test-"));
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const path = join(dir, "recipe.json");
  async function run(options: object) {
    await writeFile(path, JSON.stringify({ version: 1, url, ...options }));
    return JSON.parse((await call("run", path, "--out", dir)).stdout);
  }
  try {
    const run1 = await run({
      steps: [{ click: "button" }, { wait: ".done" }],
      performance: true,
      heapComparison: true,
      cpuProfile: true,
      pdf: true,
      accessibility: true,
      sampleMs: 250,
    });
    assert.equal(run1.ok, true);
    const folder = join(run1.directory, "1");
    const json = async (name: string) =>
      JSON.parse(await readFile(join(folder, name), "utf8"));
    assert.ok((await json("cpu.cpuprofile")).nodes.length);
    assert.ok((await json("trace.json")).traceEvents.length);
    assert.ok((await json("performance.json")).interaction.frames > 0);
    assert.ok(
      (await json("heap-diff.json")).some(
        (r: any) =>
          r.type === "object/RetainedExample" && r.countDelta === 1200,
      ),
    );
    assert.ok((await json("accessibility.json")).unnamedControls.length);
    const { events } = await json("diagnostics.json");
    assert.ok(
      events.some(
        (e: any) => e.kind === "httpError" && e.detail.status === 503,
      ),
    );
    assert.ok(
      events.some(
        (e: any) =>
          e.kind === "console" && e.detail.args.includes("fixture error"),
      ),
    );
    assert.equal(
      (await readFile(join(folder, "page.pdf"))).subarray(0, 5).toString(),
      "%PDF-",
    );
    const stats = join(folder, "performance.json");
    assert.equal(
      JSON.parse(
        (await call("compare", stats, stats, "--max-p95-increase", "0")).stdout,
      ).p95DeltaMs,
      0,
    );
    const diff = await call(
      "heap-diff",
      join(folder, "before.heapsnapshot"),
      join(folder, "after.heapsnapshot"),
    );
    assert.deepEqual(
      JSON.parse(diff.stdout).changes,
      await json("heap-diff.json"),
    );
    const variants = await run({
      viewports: ["desktop", "mobile"],
      themes: ["dark"],
      steps: [{ wait: "html[data-theme=dark]" }],
    });
    assert.equal(variants.variants.length, 2);
    for (const [i, width] of [1440, 780].entries()) {
      const png = await readFile(
        join(variants.directory, String(i + 1), "screenshot.png"),
      );
      assert.equal(png.readUInt32BE(16), width);
    }
    await assert.rejects(
      run({ steps: [{ wait: "#missing" }], timeoutMs: 5000 }),
      (e: any) => {
        const result = JSON.parse(e.stdout);
        assert.equal(e.code, 1, e.stdout);
        assert.equal(result.ok, false, e.stdout);
        assert.equal(result.variants[0].error.stage, "steps[0]", e.stdout);
        assert.ok(result.variants[0].artifacts.includes("diagnostics.json"), e.stdout);
        return true;
      },
    );
    await assert.rejects(
      run({ typo: true }),
      (e: any) =>
        e.code === 2 && JSON.parse(e.stdout).error.code === "INVALID_INPUT",
    );
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("inspect a running page and export DevTools profiles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cdp-inspect-"));
  try {
    await withChrome(async (base) => {
      const env = {
        ...process.env,
        CDP_HOST: "127.0.0.1",
        CDP_PORT: new URL(base).port,
      };
      const run = async (...args: string[]) =>
        JSON.parse(
          (await exec(process.execPath, ["src/agent.ts", ...args], { env })).stdout,
        );
      const { pages } = await run("pages");
      const page = pages[0].id;
      assert.equal(
        (await run("eval", "6 * 7", "--page", page)).result.value,
        42,
      );
      assert.ok((await run("metrics")).heap.usedSize > 0);
      assert.ok((await run("ax")).nodes.length);
      for (const cmd of ["heap", "cpu", "allocations"]) {
        const file = join(dir, cmd + ".json");
        await run(cmd, file, ...(cmd === "heap" ? [] : ["--duration", "150"]));
        const data = JSON.parse(await readFile(file, "utf8"));
        assert.ok(data.snapshot || data.nodes || data.head);
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
