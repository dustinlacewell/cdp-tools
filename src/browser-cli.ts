import { parseArgs } from "node:util";
import { selectPage } from "./cdp.ts";
import { openSession } from "./session.ts";
import { withChrome } from "./chrome.ts";
import { click, navigate, screenshot, waitFor } from "./automation.ts";

export class InputError extends Error {}

export const help = `node src/browser.ts launch [URL]
node src/browser.ts goto URL [--page MATCH]
node src/browser.ts click SELECTOR [--page MATCH]
node src/browser.ts wait SELECTOR [--page MATCH]
node src/browser.ts screenshot [FILE] [PAGE-MATCH] [--launch] [--url URL]
  [--click SELECTOR ...] [--wait SELECTOR] [--element SELECTOR | --full-page]
  [--page MATCH] [--timeout MS]

Launch runs Chrome until interrupted and prints its loopback endpoint.
Attach commands use CDP_HOST and CDP_PORT (default 127.0.0.1:9222).
--timeout sets the per-action timeout (default 10000 ms).`;

export async function runBrowser(
  args: string[],
  report?: (value: Record<string, unknown>) => void,
) {
  const [command, ...rest] = args;
  if (!command || args.includes("--help")) {
    console.log(help);
    return;
  }
  if (!["launch", "goto", "click", "wait", "screenshot"].includes(command))
    throw new Error(help);
  const capture = command === "screenshot";
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      timeout: { type: "string" },
      page: { type: "string" },
      launch: { type: "boolean" },
      url: { type: "string" },
      click: { type: "string", multiple: true },
      wait: { type: "string" },
      element: { type: "string" },
      "full-page": { type: "boolean" },
    } as const,
  });
  for (const key of Object.keys(values)) {
    if (
      key === "timeout" ||
      (key === "page" && command !== "launch") ||
      capture
    )
      continue;
    throw new InputError(`--${key} is unavailable for ${command}`);
  }
  const [arg, legacyMatch] = positionals;
  const timeout = Number(values.timeout ?? 10000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647)
    throw new InputError("Invalid --timeout in milliseconds");
  if (
    positionals.length > (capture ? 2 : 1) ||
    (!arg && !capture && command !== "launch")
  )
    throw new InputError(help);
  if (values.element !== undefined && values["full-page"])
    throw new InputError("Choose either --element or --full-page");
  if (legacyMatch && values.page)
    throw new InputError("Supply the page match once");
  const match = values.page ?? legacyMatch;
  if (values.launch && match)
    throw new InputError(
      "--launch starts with a fresh tab and cannot select an existing page",
    );

  async function run(base?: string, exited?: Promise<void>) {
    const target = await selectPage(match, base, Boolean(report));
    const session = await openSession(target.webSocketDebuggerUrl);
    try {
      if (command === "goto" || (command === "launch" && arg))
        await navigate(session, arg!, timeout);
      if (command === "click") await click(session, arg!, timeout);
      if (command === "wait") await waitFor(session, arg!, timeout);
      if (capture) {
        if (values.url !== undefined)
          await navigate(session, values.url, timeout);
        for (const selector of values.click ?? [])
          await click(session, selector, timeout);
        if (values.wait !== undefined)
          await waitFor(session, values.wait, timeout);
        const outfile = arg ?? "screenshot.png";
        await screenshot(
          session,
          outfile,
          values.element,
          values["full-page"],
          timeout,
        );
        if (report) report({ file: outfile, target: target.id });
        else console.log(outfile);
      }
    } finally {
      session.close();
    }
    if (command === "launch") {
      if (report) report({ endpoint: base });
      else console.log(base);
      await exited;
    } else if (!capture) report?.({ target: target.id });
  }
  if (command === "launch" || values.launch) await withChrome(run);
  else await run();
}
