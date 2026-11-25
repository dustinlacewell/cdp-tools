import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { selectPage } from "./cdp.ts";
import { InputError } from "./browser-cli.ts";
import { openSession } from "./session.ts";
import { accessibility, saveJson } from "./diagnostics.ts";
import { snapshot } from "./memory.ts";

export const inspectCommands = {
  eval: "cdp eval EXPRESSION [--page MATCH]",
  metrics: "cdp metrics [--page MATCH]",
  ax: "cdp ax [--page MATCH]",
  heap: "cdp heap FILE [--page MATCH]",
  cpu: "cdp cpu FILE [--duration MS] [--page MATCH]",
  allocations: "cdp allocations FILE [--duration MS] [--page MATCH]",
};
export async function inspect(
  cmd: keyof typeof inspectCommands,
  args: string[],
) {
  const sampling = cmd === "cpu" || cmd === "allocations";
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { page: { type: "string" }, duration: { type: "string" } },
  });
  const duration = Number(values.duration ?? 1000);
  if (
    (!sampling && values.duration !== undefined) ||
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > 300000 ||
    positionals.length !== (cmd === "metrics" || cmd === "ax" ? 0 : 1)
  )
    throw new InputError(inspectCommands[cmd]);
  const target = await selectPage(values.page);
  const session = await openSession(target.webSocketDebuggerUrl);
  try {
    if (cmd === "metrics") {
      await session.send("Performance.enable");
      const { metrics } = (await session.send("Performance.getMetrics")) as {
        metrics: { name: string; value: number }[];
      };
      return {
        metrics: Object.fromEntries(metrics.map((m) => [m.name, m.value])),
        heap: await session.send("Runtime.getHeapUsage"),
      };
    }
    if (cmd === "eval") {
      const r = (await session.send("Runtime.evaluate", {
        expression: positionals[0],
        awaitPromise: true,
        returnByValue: true,
      })) as {
        exceptionDetails?: {
          text: string;
          exception?: { description: string };
        };
        result: unknown;
      };
      if (r.exceptionDetails)
        throw new Error(
          r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
        );
      return { result: r.result };
    }
    if (cmd === "ax") return await accessibility(session);
    const file = positionals[0]!;
    if (cmd === "heap") await snapshot(session, file);
    if (sampling) {
      const domain = cmd === "cpu" ? "Profiler" : "HeapProfiler";
      await session.send(domain + ".enable");
      await session.send(
        domain + (cmd === "cpu" ? ".start" : ".startSampling"),
      );
      await sleep(duration);
      const result = (await session.send(
        domain + (cmd === "cpu" ? ".stop" : ".stopSampling"),
      )) as { profile: unknown };
      await saveJson(file, result.profile);
    }
    return { file, target: target.id };
  } finally {
    session.close();
  }
}
