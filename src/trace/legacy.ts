import { TraceStore } from "./trace-store.ts";
import * as commands from "./commands/index.ts";

export function legacy(
  store: TraceStore,
  command: string,
  args: string[],
  options: Record<string, string>,
): string {
  const opt = (key: string) => options[key];
  const optNum = (key: string) =>
    options[key] === undefined ? undefined : Number(options[key]);
  const positional = () => args[0];
  const { origin, within } = options;
  switch (command) {
    case "overview":
      return commands.overview(store, origin, within);
    case "threads":
      return commands.threads(store);
    case "categories":
      return commands.categories(store);
    case "names":
      return commands.names(store, {
        cat: opt("cat"),
        thread: opt("thread"),
        limit: optNum("limit") ?? 50,
        origin,
        within,
      });
    case "top":
      return commands.top(store, {
        n: optNum("n") ?? 30,
        thread: opt("thread"),
        cat: opt("cat"),
        origin,
        within,
      });
    case "summarize": {
      const name = positional();
      if (!name) {
        throw new Error("Usage: summarize <event-name>");
      }
      return commands.summarize(store, name, within);
    }
    case "search":
      return commands.search(store, {
        pattern: positional() ?? "",
        limit: optNum("limit") ?? 50,
        thread: opt("thread"),
        origin,
        within,
      });
    case "slowest":
      return commands.slowest(store, {
        pattern: positional() ?? "",
        limit: optNum("limit") ?? 20,
        origin,
        within,
      });
    case "frames":
      return commands.frames(store, optNum("hz"));
    case "frame": {
      const which = positional() ?? "worst";
      return commands.frame(store, which, optNum("hz"));
    }
    case "long-tasks":
      return commands.longTasks(store, {
        thresholdMs: optNum("threshold") ?? 50,
      });
    case "gc":
      return commands.gc(store);
    case "counters":
      return commands.counters(store, { name: opt("name") });
    case "slices":
      return commands.slices(store, {
        pattern: positional() ?? "",
        limit: optNum("limit") ?? 30,
      });
    case "tree":
      return commands.tree(store, {
        pattern: positional() ?? "",
        limit: optNum("limit") ?? 5,
        origin,
        within,
      });
    case "sources":
      return commands.sources(store);
    case "scripts":
      return commands.scripts(store, origin);
    case "calls":
      return commands.calls(store, {
        source: opt("source"),
        limit: optNum("limit") ?? 30,
        origin,
        within,
      });
    case "profile":
      return commands.profile(store, {
        limit: optNum("limit") ?? 30,
        origin,
        within,
      });
    case "profile-heavy":
      return commands.profileHeavy(store, {
        limit: optNum("limit") ?? 30,
        origin,
        within,
      });
    case "functions":
      return commands.functions(store, {
        limit: optNum("limit") ?? 50,
        origin,
        within,
        sort: (opt("sort") as "total" | "mean" | "max" | "count") ?? "total",
      });
    case "group":
      return commands.group(store, {
        pattern: positional() ?? "",
        budget: optNum("budget"),
        depth: optNum("depth") ?? 1,
        limit: optNum("limit") ?? 30,
        origin,
        within,
      });
    default:
      throw new Error("Unknown command: " + command);
  }
}
