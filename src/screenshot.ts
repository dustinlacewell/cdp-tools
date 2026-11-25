#!/usr/bin/env node
import { runBrowser } from "./browser-cli.ts";

await runBrowser(["screenshot", ...process.argv.slice(2)]).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
