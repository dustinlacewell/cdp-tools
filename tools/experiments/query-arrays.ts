#!/usr/bin/env npx tsx
/** Query the number and total size of arrays on the heap via Runtime.evaluate.
 *  This avoids the broken heap snapshot approach. */
import { findPage, evaluate } from "../../src/cdp.ts";

const page = await findPage();

// We can't enumerate all arrays from outside, but we CAN measure our own
// data structures via the extension's exposed state.
const script = `
(function() {
  const root = document.querySelector('#ofstats-root');
  if (!root) return JSON.stringify({ error: 'no ofstats-root' });

  // Try to access the store via the content script's exposed debug data
  const dbg = root.dataset.dbg;
  if (!dbg) return JSON.stringify({ error: 'no dbg data' });

  // Use performance.measureUserAgentSpecificMemory if available (async)
  // Otherwise fall back to performance.memory
  const mem = performance.memory;
  return JSON.stringify({
    usedHeap: Math.round(mem?.usedJSHeapSize / 1048576),
    totalHeap: Math.round(mem?.totalJSHeapSize / 1048576),
    heapLimit: Math.round(mem?.jsHeapSizeLimit / 1048576),
    dbg: JSON.parse(dbg),
  });
})()
`;

const result = await evaluate(page, script);
console.log(JSON.parse(result));
