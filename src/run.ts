import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { withChrome } from "./chrome.ts";
import { listTargets } from "./cdp.ts";
import { openSession } from "./session.ts";
import { click, navigate, screenshot, waitFor } from "./automation.ts";
import { dimensions, type Recipe } from "./recipe.ts";
import { accessibility, benchmark, observe, saveJson } from "./diagnostics.ts";
import { snapshot, compareHeaps } from "./memory.ts";

export async function runRecipe(recipe: Recipe, output: string) {
  const parent = resolve(output);
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, "run-"));
  const variants = [];
  await saveJson(join(dir, "recipe.json"), recipe);
  for (const viewport of recipe.viewports)
    for (const theme of recipe.themes)
      for (let sample = 1; sample <= recipe.samples; sample++) {
        const variant: string = String(variants.length + 1);
        const folder = join(dir, variant);
        await mkdir(folder);
        const settings = dimensions(viewport);
        const artifacts: string[] = [];
        let browser: string | undefined;
        let stage = "launch";
        let error: string | undefined;
        try {
          await withChrome(async (base) => {
            const target = (await listTargets(base)).find(
              (t) => t.type === "page",
            );
            if (!target) throw new Error("Chrome did not create a page");
            const session = await openSession(target.webSocketDebuggerUrl);
            try {
              stage = "setup";
              browser = (
                (await session.send("Browser.getVersion")) as {
                  product: string;
                }
              ).product;
              const diagnostics = await observe(session);
              try {
                await session.send("Emulation.setDeviceMetricsOverride", {
                  width: settings.width,
                  height: settings.height,
                  deviceScaleFactor: settings.scale,
                  mobile: settings.mobile,
                });
                await session.send("Emulation.setEmulatedMedia", {
                  features: [{ name: "prefers-color-scheme", value: theme }],
                });
                stage = "navigate";
                await navigate(session, recipe.url, recipe.timeoutMs);
                const before = join(folder, "before.heapsnapshot"),
                  after = join(folder, "after.heapsnapshot");
                if (recipe.heapComparison) {
                  stage = "heap-before";
                  await snapshot(session, before);
                  artifacts.push("before.heapsnapshot");
                }
                if (recipe.cpuProfile) {
                  await session.send("Profiler.enable");
                  await session.send("Profiler.start");
                }
                async function steps() {
                  for (const [index, step] of recipe.steps.entries()) {
                    stage = "steps[" + index + "]";
                    if ("click" in step)
                      await click(session, step.click, recipe.timeoutMs);
                    else await waitFor(session, step.wait, recipe.timeoutMs);
                  }
                }
                if (recipe.performance || recipe.tracePreset) {
                  stage = "benchmark";
                  const stats = await benchmark(
                    session,
                    folder,
                    steps,
                    recipe.sampleMs,
                    recipe.tracePreset,
                  );
                  await saveJson(join(folder, "performance.json"), stats);
                  artifacts.push("performance.json", "trace.json");
                } else await steps();
                if (recipe.cpuProfile) {
                  stage = "cpu-profile";
                  const { profile } = (await session.send("Profiler.stop")) as {
                    profile: unknown;
                  };
                  await saveJson(join(folder, "cpu.cpuprofile"), profile);
                  artifacts.push("cpu.cpuprofile");
                }
                if (recipe.heapComparison) {
                  stage = "heap-after";
                  await snapshot(session, after);
                  artifacts.push("after.heapsnapshot");
                  await saveJson(
                    join(folder, "heap-diff.json"),
                    await compareHeaps(before, after),
                  );
                  artifacts.push("heap-diff.json");
                }
                if (recipe.screenshot !== "off") {
                  stage = "screenshot";
                  await screenshot(
                    session,
                    join(folder, "screenshot.png"),
                    typeof recipe.screenshot === "object"
                      ? recipe.screenshot.element
                      : undefined,
                    recipe.screenshot === "full",
                    recipe.timeoutMs,
                  );
                  artifacts.push("screenshot.png");
                }
                if (recipe.accessibility) {
                  stage = "accessibility";
                  await saveJson(
                    join(folder, "accessibility.json"),
                    await accessibility(session),
                  );
                  artifacts.push("accessibility.json");
                }
                if (recipe.pdf) {
                  stage = "pdf";
                  const options =
                    recipe.pdf === true
                      ? { printBackground: true, preferCSSPageSize: true }
                      : recipe.pdf;
                  const { data } = (await session.send(
                    "Page.printToPDF",
                    options,
                    recipe.timeoutMs,
                  )) as { data: string };
                  await writeFile(
                    join(folder, "page.pdf"),
                    Buffer.from(data, "base64"),
                  );
                  artifacts.push("page.pdf");
                }
              } finally {
                await saveJson(join(folder, "diagnostics.json"), diagnostics());
                artifacts.push("diagnostics.json");
              }
            } finally {
              session.close();
            }
          });
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
        variants.push({
          ok: error === undefined,
          folder: variant,
          settings,
          theme,
          sample,
          browser,
          artifacts,
          ...(error === undefined ? {} : { error: { stage, message: error } }),
        });
        await saveJson(join(dir, "manifest.json"), { version: 1, variants });
      }
  return {
    ok: variants.every((v) => v.ok),
    directory: dir,
    manifest: join(dir, "manifest.json"),
    variants,
  };
}
