#!/usr/bin/env npx tsx
/** List open page targets. */
import { listTargets } from "../src/cdp.ts";

const targets = await listTargets();
const pages = targets.filter((t) => t.type === "page");
for (const p of pages) {
  console.log(`${p.title}\t${p.url}`);
}
