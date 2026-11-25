#!/usr/bin/env node
import { findPage } from "../src/cdp.ts";
import { openSession } from "../src/session.ts";
import { snapshot } from "../src/memory.ts";

const file = process.argv[2] ?? ("heap-" + Date.now() + ".heapsnapshot");
const page = await findPage(process.argv[3]);
const session = await openSession(page.webSocketDebuggerUrl);
try {
  await snapshot(session, file);
  console.log(file);
} finally { session.close(); }
