#!/usr/bin/env npx tsx
/** Evaluate a JS expression on a page.
 *  Usage: eval.ts <expr> [page-match]
 *         eval.ts -f <file> [page-match]
 *         echo "expr" | eval.ts - [page-match]
 */
import { findPage, evaluate } from "../src/cdp.ts";
import { readFileSync } from "fs";

let expr: string | undefined;
let matchArg: string | undefined;

if (process.argv[2] === "-f") {
  expr = readFileSync(process.argv[3]!, "utf-8");
  matchArg = process.argv[4];
} else if (process.argv[2] === "-") {
  expr = readFileSync(0, "utf-8");
  matchArg = process.argv[3];
} else {
  expr = process.argv[2];
  matchArg = process.argv[3];
}

if (!expr) {
  console.error("Usage: eval.ts <expr> | -f <file> | - (stdin)  [page-match]");
  process.exit(1);
}

const page = await findPage(matchArg);
const result = await evaluate(page, expr);
console.log(result);
