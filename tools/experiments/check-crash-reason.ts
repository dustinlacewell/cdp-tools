#!/usr/bin/env npx tsx
/** Check chrome://crashes for recent crash reasons via CDP. */
import { findPage, send, evaluate } from "../../src/cdp.ts";

// Navigate to chrome://crashes to check crash reasons
// Actually - we can't navigate to chrome:// URLs via CDP on a page target.
// Instead, let's check if the Inspector reports any crash info.

const page = await findPage();

// Check if the page has reported any errors or violations
const result = await evaluate(page, `
JSON.stringify({
  // Check if we're in a degraded state
  visibilityState: document.visibilityState,
  hasFocus: document.hasFocus(),
  // Memory pressure
  memory: {
    used: Math.round(performance.memory?.usedJSHeapSize / 1048576),
    total: Math.round(performance.memory?.totalJSHeapSize / 1048576),
    limit: Math.round(performance.memory?.jsHeapSizeLimit / 1048576),
    pctUsed: Math.round((performance.memory?.usedJSHeapSize / performance.memory?.jsHeapSizeLimit) * 100),
  },
  // Check total entries in PerformanceObserver for long tasks
  longTasks: performance.getEntriesByType('longtask').length,
  // navigation timing
  timing: {
    domComplete: performance.timing?.domComplete,
    loadEventEnd: performance.timing?.loadEventEnd,
  },
})
`);
console.log(JSON.parse(result));
