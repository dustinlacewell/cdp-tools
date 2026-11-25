import { TraceStore } from "../trace-store.ts";
import type { TraceEvent } from "../types.ts";
import { us2ms, fmtMs } from "../format.ts";

export function tree(
  store: TraceStore,
  opts: { pattern: string; limit: number; origin?: string; within?: string }
): string {
  if (!opts.pattern) return "Provide a pattern.";
  const re = new RegExp(opts.pattern, "i");

  const roots = store
    .completeEvents({ name: re, origin: opts.origin, within: opts.within })
    .sort((a, b) => b.dur! - a.dur!)
    .slice(0, opts.limit);

  if (roots.length === 0) return `No events matching "${opts.pattern}".`;

  const lines: string[] = [];
  for (const root of roots) {
    lines.push(
      `\n━━ ${root.name} (${fmtMs(us2ms(root.dur!))}) at ${fmtMs(us2ms(root.ts - store.minTs))} ━━`
    );

    const printTree = (parent: TraceEvent, depth: number) => {
      const nested = store.directChildren(parent);
      nested.sort((a, b) => b.dur! - a.dur!);
      const topNested = nested.slice(0, 8);

      for (const child of topNested) {
        const indent = "  ".repeat(depth);
        const pct = ((child.dur! / parent.dur!) * 100).toFixed(0);
        lines.push(
          `${indent}├─ ${child.name} ${fmtMs(us2ms(child.dur!))} (${pct}%)`
        );
        if (depth < 4) {
          printTree(child, depth + 1);
        }
      }
    };

    printTree(root, 1);
  }

  return lines.join("\n");
}
