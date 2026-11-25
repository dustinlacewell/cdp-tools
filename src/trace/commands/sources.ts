import { TraceStore } from "../trace-store.ts";
import { us2ms, fmtMs, table } from "../format.ts";

export function sourceUrls(store: TraceStore): string[] {
  const urls = new Set<string>();
  for (const e of store.events) {
    if (!e.args) continue;
    extractUrls(e.args, urls);
  }
  return [...urls].sort();
}

export function sources(store: TraceStore): string {
  return sourceUrls(store).join("\n") || "No source URLs found.";
}

function extractUrls(obj: unknown, urls: Set<string>): void {
  if (typeof obj === "string") {
    if (obj.startsWith("http://") || obj.startsWith("https://")) {
      urls.add(obj);
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) extractUrls(item, urls);
    return;
  }
  if (obj && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      extractUrls(val, urls);
    }
  }
}

export function scripts(store: TraceStore, origin?: string): string {
  const re = origin ? new RegExp(origin,"i") : null;
  const entries = store.scriptsFor().filter(s => !re || re.test(s.url));
  if (entries.length === 0) return "No scripts matching origin filter.";

  return table(
    ["PID", "Script ID", "URL"],
    entries.map(s => [String(s.pid),s.scriptId,s.url]),
    ["r", "l"]
  );
}

export function calls(
  store: TraceStore,
  opts: { source?: string; limit: number; origin?: string; within?: string }
): string {
  // Start with completeEvents to get within-filtering for free
  let events = store.completeEvents({
    name: /^(FunctionCall|EvaluateScript)$/,
    within: opts.within,
  });

  const sourceFilter = opts.source ?? opts.origin;
  if (sourceFilter) {
    const re = new RegExp(sourceFilter, "i");
    events = events.filter((e) => {
      const url = store.eventUrl(e);
      return url !== null && re.test(url);
    });
  }

  events.sort((a, b) => b.dur! - a.dur!);

  if (events.length === 0) return "No matching function calls found.";

  const showing = events.slice(0, opts.limit);
  return table(
    ["Name", "Duration", "Source", "Offset"],
    showing.map((e) => {
      const url = store.eventUrl(e) ?? "";
      const short = url.split("/").pop() ?? url;
      return [
        e.name ?? "?",
        fmtMs(us2ms(e.dur!)),
        short,
        fmtMs(us2ms(e.ts - store.minTs)),
      ];
    }),
    ["l", "r", "l", "r"]
  );
}
