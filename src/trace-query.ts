#!/usr/bin/env node
import { runTraceQuery } from "./trace/cli.ts";
await runTraceQuery(process.argv.slice(2));
