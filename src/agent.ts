#!/usr/bin/env node
import { parseArgs } from "node:util";
import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { recipeSchema } from "./recipe.ts";
import { runRecipe } from "./run.ts";
import { compareHeaps } from "./memory.ts";
import { listTargets } from "./cdp.ts";
import { inspect, inspectCommands } from "./inspect.ts";
import { InputError, runBrowser, help as browserHelp } from "./browser-cli.ts";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
function emit(data: unknown) {
  console.log(JSON.stringify(data));
}
const usage = {
  version,
  commands: {
    ...inspectCommands,
    trace: "cdp trace COMMAND FILE [options] | cdp trace record RECIPE.json [--preset game|standard] [--out FILE]. See cdp trace --help.",
    schema: "Emit the JSON Schema for a run recipe",
    run: "cdp run RECIPE.json|- [--out DIRECTORY]",
    pages: "List attachable page IDs, titles and URLs",
    "heap-diff": "cdp heap-diff BEFORE.heapsnapshot AFTER.heapsnapshot",
    compare:
      "cdp compare BASELINE-performance.json CANDIDATE-performance.json [--max-p95-increase MS]",
    browser: browserHelp.replaceAll("node src/browser.ts", "cdp"),
  },
  exitCodes: { success: 0, failure: 1, invalidInput: 2 },
  schemaVersion: 1,
};
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const recording = cmd === "trace" && args[0] === "record";
  if (cmd === "trace") {
    const [command, file, ...options] = args;
    if (command === "--version") return emit({ version });
    if (!command || command === "help" || args.includes("--help") || args.includes("-h")) {
      const {help} = await import("./trace/help.ts");
      console.log("cdp trace record RECIPE.json [--preset game|standard] [--out FILE]\n" +
        help.replace("trace-query <trace.json> <command>", "cdp trace <command> <trace.json>"));
      return;
    }
    if (!recording) {
      if (!file) throw new InputError("Usage: cdp trace COMMAND FILE [options]");
      const {runTraceQuery} = await import("./trace/cli.ts");
      if (!options.includes("--format")) options.push("--format", "json");
      return runTraceQuery([file, command, ...options]);
    }
  }
  if (!cmd || cmd === "help" || args.includes("--help") || cmd === "--help")
    return emit(usage);
  if (cmd === "--version" || cmd === "version") return emit({ version });
  if (cmd === "schema" && !args.length)
    return emit(z.toJSONSchema(recipeSchema, { io: "input" }));
  if (cmd === "run" || recording) {
    const { values, positionals } = parseArgs({
      args: recording ? args.slice(1) : args,
      allowPositionals: true,
      options: { out: { type: "string" }, preset: { type: "string" } },
    });
    if (positionals.length !== 1 || (!recording && values.preset)) throw new InputError(recording ? usage.commands.trace : usage.commands.run);
    const source =
      positionals[0] === "-"
        ? readFileSync(0, "utf8")
        : await readFile(positionals[0]!, "utf8");
    const recipe = recipeSchema.parse(
      JSON.parse(source.replace(/^\uFEFF/, "")),
    );
    if (recording) {
      recipe.tracePreset = z.enum(["standard","game"]).parse(values.preset ?? recipe.tracePreset ?? "game");
      if (values.out && recipe.viewports.length * recipe.themes.length * recipe.samples !== 1)
        throw new InputError("A single --out FILE requires one viewport, theme, and sample. Omit --out to record all variants.");
    }
    const result = await runRecipe(recipe, recording ? "artifacts" : values.out ?? "artifacts");
    if (recording && result.ok && values.out) {
      const file = resolve(values.out);
      await mkdir(dirname(file), { recursive: true });
      const temp = file + "." + randomUUID() + ".tmp";
      try {
        await copyFile(join(result.directory, result.variants[0]!.folder, "trace.json"), temp);
        await rename(temp, file);
      } finally { await rm(temp, { force: true }); }
    }
    emit({ schemaVersion: 1, ...result, ...(recording && result.ok && values.out ? {trace:resolve(values.out)} : {}) });
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "pages" && !args.length) {
    const pages = (await listTargets())
      .filter((t) => t.type === "page")
      .map(({ id, title, url }) => ({ id, title, url }));
    return emit({ ok: true, pages });
  }
  if (Object.hasOwn(inspectCommands, cmd))
    return emit({
      ok: true,
      ...(await inspect(cmd as keyof typeof inspectCommands, args)),
    });
  if (cmd === "heap-diff" && args.length === 2)
    return emit({ ok: true, changes: await compareHeaps(args[0]!, args[1]!) });
  if (cmd === "compare") {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { "max-p95-increase": { type: "string" } },
    });
    if (positionals.length !== 2) throw new InputError(usage.commands.compare);
    const limit = Number(values["max-p95-increase"] ?? Infinity);
    if (Number.isNaN(limit) || limit < 0)
      throw new InputError("Invalid regression threshold");
    const metric = z.object({
      interaction: z.object({
        p95Ms: z.number(),
        frames: z.number().positive(),
        mainThreadTaskPct: z.number(),
      }),
    });
    const [a, b] = await Promise.all(
      positionals.map(
        async (file) =>
          metric.parse(JSON.parse(await readFile(file, "utf8"))).interaction,
      ),
    );
    const p95DeltaMs = b!.p95Ms - a!.p95Ms;
    const ok = p95DeltaMs <= limit;
    emit({
      ok,
      p95DeltaMs,
      mainThreadTaskPctDelta: b!.mainThreadTaskPct - a!.mainThreadTaskPct,
    });
    if (!ok) process.exitCode = 1;
    return;
  }
  if (["launch", "goto", "click", "wait", "screenshot"].includes(cmd)) {
    return runBrowser([cmd, ...args], (result) =>
      emit({ ok: true, ...result }),
    );
  }
  throw new InputError(
    "Invalid command or arguments. Run cdp help for syntax.",
  );
}
await main().catch((error) => {
  const invalid =
    error instanceof InputError ||
    error instanceof SyntaxError ||
    error instanceof z.ZodError ||
    String(error.code ?? "").startsWith("ERR_PARSE_ARGS");
  emit({
    ok: false,
    error: {
      code: invalid ? "INVALID_INPUT" : "COMMAND_FAILED",
      message: error.message,
      ...(error instanceof z.ZodError ? { issues: error.issues } : {}),
    },
  });
  process.exitCode = invalid ? 2 : 1;
});
