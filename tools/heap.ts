#!/usr/bin/env npx tsx
/** Print JS heap stats. Usage: heap.ts [page-match] */
import { findPage, evaluate } from "../src/cdp.ts";

const page = await findPage(process.argv[2]);
const raw = await evaluate(
  page,
  `JSON.stringify({
    usedHeapMB: Math.round(performance.memory?.usedJSHeapSize / 1048576),
    totalHeapMB: Math.round(performance.memory?.totalJSHeapSize / 1048576),
    limitMB: Math.round(performance.memory?.jsHeapSizeLimit / 1048576),
  })`,
);
console.log(raw);
