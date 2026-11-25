import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { help } from "./help.ts";
import { structured } from "./structured.ts";
import { legacy } from "./legacy.ts";
import { loadTrace } from "./load.ts";
import { gameReport } from "./game-report.ts";
import { health, remapProfile, selfTimes } from "./analysis.ts";
import { diff } from "./commands/diff.ts";
import { profileData } from "./commands/profile.ts";
import { stats, topByDuration, filterByThread } from "./format.ts";
import { decodePresentation } from "./presentation.ts";
import { gameMetrics } from "./game-metrics.ts";
import type { TraceStore } from "./trace-store.ts";

const flags: Record<string, string> = {
  overview: "origin within",
  threads: "",
  categories: "",
  names: "cat thread limit origin within",
  top: "n cat thread origin within",
  summarize: "within",
  search: "thread limit origin within",
  slowest: "limit origin within",
  frames: "hz limit",
  frame: "hz",
  "long-tasks": "threshold",
  gc: "",
  counters: "name",
  slices: "limit",
  tree: "limit origin within",
  sources: "",
  scripts: "origin",
  calls: "source limit origin within",
  functions: "limit sort origin within",
  profile: "limit origin within",
  "profile-heavy": "limit origin within",
  group: "limit depth budget origin within",
  diff: "n limit threshold budget depth origin within hz",
  inventory: "limit hz",
  pacing: "limit hz",
  diagnose: "limit hz",
  metrics: "limit",
  events: "limit origin within",
  self: "limit origin within",
  check: "budget within origin",
};
const globalFlags = [
  "format",
  "pid",
  "tid",
  "from",
  "to",
  "source-map",
  "map-url",
];
const numeric = new Set([
  "pid",
  "tid",
  "from",
  "to",
  "n",
  "limit",
  "threshold",
  "depth",
  "budget",
  "hz",
]);
const integer = new Set(["pid", "tid", "limit", "depth", "n"]);
const gameCommands = ["inventory", "pacing", "diagnose", "metrics"];
const needsPattern = [
  "search",
  "slowest",
  "check",
  "summarize",
  "tree",
  "group",
  "slices",
];
const acceptsArg = [
  ...needsPattern,
  "events",
  "self",
  "metrics",
  "diagnose",
  "frame",
  "search",
  "slowest",
];

function optionsFor(args: string[]) {
  const argsOnly: string[] = [];
  const options: Record<string, string> = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      argsOnly.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const val = args[++i];
    if (!val || val.startsWith("--"))
      throw new Error("Missing value for " + arg);
    if (options[key] !== undefined) throw new Error("Repeated option " + arg);
    options[key] = val;
  }
  const command = argsOnly.shift() ?? "";
  if (!Object.hasOwn(flags, command))
    throw new Error("Unknown command: " + command + ". Use --help.");
  const allowed = new Set([...globalFlags, ...flags[command]!.split(" ")]);
  for (const [key, val] of Object.entries(options)) {
    if (!allowed.has(key))
      throw new Error(`Unsupported option --${key} for ${command}`);
    if (numeric.has(key)) {
      const n = Number(val);
      if (
        !Number.isFinite(n) ||
        n < 0 ||
        (integer.has(key) && !Number.isSafeInteger(n)) ||
        (["hz", "limit", "n"].includes(key) && n === 0)
      )
        throw new Error("Invalid number for --" + key);
    }
  }
  if (options.format && !["text", "json"].includes(options.format))
    throw new Error("Use --format text or json.");
  if (Number(options.depth ?? 0) > 32)
    throw new Error("Maximum tree depth is 32.");
  if (options.sort && !["total", "mean", "max", "count"].includes(options.sort))
    throw new Error("Invalid --sort.");
  if (options.from && options.to && Number(options.from) >= Number(options.to))
    throw new Error("--to must exceed --from.");
  if (!!options["map-url"] !== !!options["source-map"])
    throw new Error("Supply --map-url and --source-map together.");
  if (needsPattern.includes(command) && !argsOnly[0])
    throw new Error(command + " requires an event pattern.");
  if (command === "check" && options.budget === undefined)
    throw new Error("check requires --budget MS.");
  if (command === "diff") {
    if (
      !argsOnly[0] ||
      ![
        "profile",
        "top",
        "group",
        "health",
        "frames",
        "gc",
        "long-tasks",
      ].includes(argsOnly[1] ?? "")
    )
      throw new Error(
        "Use diff FILE profile|top|group|health|frames|gc|long-tasks.",
      );
    if (argsOnly.length !== (argsOnly[1] === "group" ? 3 : 2))
      throw new Error("Unexpected or missing diff argument.");
  } else if (argsOnly.length > (acceptsArg.includes(command) ? 1 : 0))
    throw new Error("Unexpected argument for " + command);
  return { command, options, argsOnly };
}

async function query(argv: string[]) {
  if (argv.includes("--version")) {
    console.log(
      JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(help);
    return;
  }
  const path = argv.shift();
  if (!path || !argv.length)
    throw new Error(
      "Usage: trace-query FILE COMMAND [options]. Use --help for commands.",
    );
  const { command, options, argsOnly } = optionsFor(argv);
  const pattern = argsOnly[0];
  const json = options.format === "json";
  const num = (k: string) =>
    options[k] === undefined ? undefined : Number(options[k]);
  const limit = num("limit") ?? 30;
  const scope = {
    limit,
    pid: num("pid"),
    tid: num("tid"),
    from: num("from"),
    to: num("to"),
    hz: num("hz"),
  };
  async function open(input: string) {
    const store = await loadTrace(input);
    if (options["source-map"])
      remapProfile(store, options["map-url"]!, options["source-map"]);
    if (!gameCommands.includes(command))
      store.scope(scope.pid, scope.tid, scope.from, scope.to);
    return store;
  }
  if (command === "diff" && path === "-" && pattern === "-")
    throw new Error("Only one diff input can use stdin.");
  const store = await open(path);
  function comparison(s: TraceStore) {
    const timeline = decodePresentation(s.events, scope);
    const gaps = timeline.frames.flatMap((f) =>
      f.gapMs === null ? [] : [f.gapMs],
    );
    return {
      frameSource: timeline.source,
      ...health(s, gaps, num("threshold")),
    };
  }
  let data: unknown;
  let formatted: string | undefined;
  if (gameCommands.includes(command))
    data = gameReport(store, command, pattern, scope);
  else if (command === "diff") {
    const other = await open(pattern!);
    const subcommand = argsOnly[1]!;
    if (["health", "frames", "gc", "long-tasks"].includes(subcommand)) {
      const before = comparison(store),
        after = comparison(other);
      const delta = (a: number | null, b: number | null) =>
        a === null || b === null ? null : b - a;
      data = {
        before,
        after,
        delta: {
          frameP95Ms:
            before.frameSource === after.frameSource
              ? delta(
                  before.frameGapMs?.p95 ?? null,
                  after.frameGapMs?.p95 ?? null,
                )
              : null,
          gcMsPerSecond: delta(before.gcMsPerSecond, after.gcMsPerSecond),
          longTasksPerSecond: delta(
            before.longTasksPerSecond,
            after.longTasksPerSecond,
          ),
        },
      };
      if (subcommand === "frames")
        data = {
          before: { source: before.frameSource, gapMs: before.frameGapMs },
          after: { source: after.frameSource, gapMs: after.frameGapMs },
          p95DeltaMs:
            before.frameSource === after.frameSource
              ? delta(
                  before.frameGapMs?.p95 ?? null,
                  after.frameGapMs?.p95 ?? null,
                )
              : null,
        };
      if (subcommand === "gc")
        data = {
          beforeMs: before.gcPauseMs,
          afterMs: after.gcPauseMs,
          beforeMsPerSecond: before.gcMsPerSecond,
          afterMsPerSecond: after.gcMsPerSecond,
          deltaMsPerSecond: delta(before.gcMsPerSecond, after.gcMsPerSecond),
        };
      if (subcommand === "long-tasks")
        data = {
          beforeCount: before.longTasks,
          afterCount: after.longTasks,
          beforePerSecond: before.longTasksPerSecond,
          afterPerSecond: after.longTasksPerSecond,
          deltaPerSecond: delta(
            before.longTasksPerSecond,
            after.longTasksPerSecond,
          ),
        };
    } else {
      formatted = diff(store, other, {
        subcommand,
        origin: options.origin,
        within: options.within,
        limit,
        n: num("n"),
        pattern: argsOnly[2],
      });
      const values = (s: TraceStore) =>
        subcommand === "profile"
          ? profileData(s, options).entries.slice(0, limit)
          : subcommand === "top"
            ? topByDuration(
                s.completeEvents({
                  origin: options.origin,
                  within: options.within,
                }),
                num("n") ?? limit,
              )
            : stats(
                s
                  .completeEvents({ name: argsOnly[2], within: options.within })
                  .map((e) => e.dur! / 1000),
              );
      if (json)
        data = {
          before: values(store),
          after: values(other),
          unit: "ms",
          report: formatted,
        };
    }
  } else if (["self", "check", "events"].includes(command)) {
    const events = store.completeEvents({
      name: pattern,
      origin: options.origin,
      within: options.within,
    });
    if (command === "self") data = selfTimes(store, events).slice(0, limit);
    if (command === "events")
      data = events
        .sort((a, b) => a.ts - b.ts)
        .slice(0, limit)
        .map((e) => ({
          name: e.name,
          pid: e.pid,
          tid: e.tid,
          startUs: e.ts,
          durationMs: e.dur! / 1000,
          source: store.eventUrl(e),
        }));
    if (command === "check") {
      let durations = events.map((e) => e.dur! / 1000);
      if (!durations.length && !options.within && !options.origin) {
        const re = new RegExp(pattern!, "i");
        durations = gameMetrics(store.events)
          .entries.filter((m) => m.kind === "span" && re.test(m.name))
          .map((m) => m.durationUs / 1000);
      }
      if (!durations.length)
        throw new Error("No measurable occurrences match this budget.");
      const distribution = stats(durations);
      const passed = distribution.p95 <= num("budget")!;
      data = {
        pattern,
        count: distribution.count,
        p95Ms: distribution.p95,
        budgetMs: num("budget"),
        passed,
      };
      if (!passed) process.exitCode = 2;
    }
  } else {
    if (!json || command === "overview")
      formatted = legacy(store, command, argsOnly, options);
    if (json) {
      if (command === "threads") data = store.threads;
      else if (command === "profile" || command === "profile-heavy") {
        const result = profileData(store, options);
        if (command === "profile-heavy")
          result.entries.sort((a, b) => b.totalMs - a.totalMs);
        data = { ...result, entries: result.entries.slice(0, limit) };
      } else if (command === "top") {
        let events = store.completeEvents({
          origin: options.origin,
          within: options.within,
          cat: options.cat,
        });
        if (options.thread)
          events = filterByThread(events, store, options.thread);
        data = { unit: "ms", entries: topByDuration(events, num("n") ?? 30) };
      } else if (command === "overview")
        data = {
          durationMs: store.durationMs,
          traceStartUs: store.minTs,
          events: store.events.length,
          threads: store.threads,
          report: formatted,
        };
      else if (command === "summarize")
        data = {
          pattern,
          durationMs: stats(
            store
              .completeEvents({ name: pattern, within: options.within })
              .map((e) => e.dur! / 1000),
          ),
        };
      else data = structured(store, command, pattern, options, limit);
    }
  }
  if (formatted?.startsWith("Invalid frame index.")) throw new Error(formatted);
  if (json) console.log(JSON.stringify({ schemaVersion: 1, command, data }));
  else
    console.log(
      formatted ??
        inspect(data, {
          colors: process.stdout.isTTY,
          depth: null,
          maxArrayLength: null,
          compact: false,
        }),
    );
}

export async function runTraceQuery(argv: string[]) {
  try {
    await query([...argv]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(argv.includes("json") ? JSON.stringify({ schemaVersion: 1, error: message }) : "trace-query: " + message);
    process.exitCode = 1;
  }
}
