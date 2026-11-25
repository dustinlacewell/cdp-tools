# CDP Tools 1.1

[Project site and downloads](https://cdp.ldlework.com)

`cdp` drives Chrome and returns JSON for agents. Use a recipe for repeatable work or target a running tab with individual commands. Node 24 or newer and an installed Chrome or Chromium executable are required. Set `CHROME_PATH` to the executable if automatic discovery misses it.

## Install from this checkout

```sh
npm ci
npm run build
npm link
cdp version
cdp help
```

For a portable installation, run `npm pack` and install the resulting tarball with `npm install -g ./cdp-tools-1.1.0.tgz`. The package contains compiled JavaScript. To run locally without linking, use `node dist/agent.js` in place of `cdp`.

## Run a recipe

Save the following as `recipe.json`, substituting your app's URL and selectors.

```json
{
  "version": 1,
  "url": "http://localhost:3000",
  "steps": [
    { "click": "#open-results" },
    { "wait": "#results.ready" }
  ],
  "viewports": ["desktop", "mobile"],
  "themes": ["light", "dark"],
  "screenshot": { "element": "#results" },
  "accessibility": true
}
```

```sh
cdp schema
cdp run recipe.json --out artifacts
```

An agent can also pipe a JSON document into `cdp run -`. The schema command emits the authoritative input schema, including defaults and limits. Unknown keys fail validation before Chrome starts.

Each viewport, theme, and sample combination runs in its own hidden browser with a fresh profile. Identical actions replay from the initial URL each time. Desktop defaults to 1440 x 900 at 1x. Mobile uses a 390 x 844 viewport at 2x with mobile layout enabled. Custom viewports accept `width`, `height`, `scale`, and `mobile`.

The final JSON contains `ok`, an absolute run directory, a manifest path, and one result per variant. Each variant names its artifact subdirectory, browser version, settings, and files. Failed variants include the failing stage and message. Diagnostics record HTTP errors, failed requests, console warnings/errors, and uncaught exceptions beginning before navigation. They are saved even when a selector times out. The first 2,000 events are retained, with a dropped-event count. A page logging an error does not itself fail the recipe.

## Recipe outputs

| Option | Result |
| --- | --- |
| `screenshot` | Viewport PNG by default. Use `"full"`, `{"element":"selector"}`, or `"off"`. |
| `pdf` | Print the final page to PDF. Accepts `true` or an object with `landscape`, `printBackground`, and `preferCSSPageSize`. |
| `accessibility` | Export Chrome's accessible roles, names, states, node relationships, and IDs of unnamed controls. |
| `performance` | Collect a DevTools trace, idle and interaction frame pacing, renderer task time, and their deltas. `sampleMs` controls idle and post-action observation windows. `samples` repeats the recipe in independent profiles. |
| `cpuProfile` | Export a V8 sampling CPU profile covering the interaction. With performance enabled, it includes the baseline and observation windows. |
| `heapComparison` | Take complete snapshots before and after the interaction and rank changes by shallow bytes and instance count. Objects and native nodes are grouped by class. Strings are grouped by node type. |

For a release comparison, use the same viewport, Chrome version, and steps in both runs. Frame timing uses requestAnimationFrame in the current document, so measured steps should stay in that document. The threshold below allows a 3 ms increase in interaction p95 frame time. Heap differences show aggregate growth between two snapshots. For large heaps, the comparison process needs enough memory to parse a complete snapshot.

```sh
cdp compare baseline/performance.json candidate/performance.json --max-p95-increase 3
cdp heap-diff before.heapsnapshot after.heapsnapshot
```

## Work with a running tab

`cdp launch [URL]` starts hidden Chrome, emits a JSON record with its loopback endpoint, and remains attached until interrupted. Set `CDP_PORT` to that endpoint's port in a second terminal. Commands can also attach to an existing debug session. The default endpoint is 127.0.0.1:9222 and `CDP_HOST` overrides the host.

| Commands | Use |
| --- | --- |
| `pages`, `goto URL`, `click SELECTOR`, `wait SELECTOR` | Discover target IDs and control a tab. Pass `--page ID` when multiple tabs are open. A unique title or URL substring also works. |
| `screenshot [FILE]` | Capture an attached tab or launch with `--launch --url URL`. Supports repeated `--click`, a final `--wait`, and either `--element` or `--full-page`. |
| `eval EXPRESSION`, `metrics`, `ax` | Evaluate page JavaScript, read Chrome performance and heap metrics, or export the accessibility tree as JSON. |
| `heap FILE`, `cpu FILE`, `allocations FILE` | Save a heap snapshot, CPU profile, or sampled allocation profile. Sampling commands accept `--duration MS`. |

Navigation waits for main-document load. Selectors address the main document's light DOM. Wait checks visibility and nonzero size. Click scrolls the element into view, checks the hit target, and dispatches mouse input. Use an application-specific readiness selector for delayed rendering.

## Trace recording and offline analysis

The package installs both `cdp` and the file-first `trace-query` compatibility command. Offline queries accept Chrome trace JSON, gzip, or stdin (`-`). Analysis retains an in-memory index of the recording. Use `cdp trace --help` for the full command list.

```sh
cdp trace record recipe.json --preset game --out shot.json
cdp trace inventory shot.json
cdp trace diagnose shot.json
cdp trace profile shot.json --limit 10 --format text
trace-query shot.json inventory --format json
```

Recording uses the normal recipe runner and writes its manifest and artifacts under `artifacts/`. For one variant, `--out FILE` also exports the raw Chrome JSON. For multiple variants, omit that flag and follow the manifest. The game preset includes V8 sampling, compositor, frame, and graphics events. Include `"tracePreset": "game"` in a `cdp run` recipe to request the same recording. Explicit device timings still require timers exported by the application.

`cdp trace` queries default to JSON. The compatibility command defaults to text. Both return exit 2 for a breached trace budget and exit 1 for missing measurements or invalid queries. The bundled Slingshot page includes playable before/after versions and the actual recordings. [Trace Query](https://cdp.ldlework.com/trace-query/)

## Agent contract

The installed CLI writes JSON to stdout. Exit 0 means success, exit 1 means an execution failure or an exceeded comparison threshold, and exit 2 means invalid input. `help`, `version`, and `schema` are discovery commands. For a failed run, inspect `variants[].error` and the variant's `diagnostics.json`. Every run gets a new output directory, including retries and concurrent invocations.

## Source tools and verification

The packaged CLI lives in `src/`, integration tests in `tests/`, standalone utilities in `tools/`, and the Vite website in `site/`. The build writes JavaScript to `dist/`. Release archives live in `artifacts/release/`.

For site development, run `npm ci` and `npm run dev` from `site/`. Use `npm run build` to generate `site/dist/` and `npm run preview` to serve that build locally.

The original `node src/screenshot.ts [outfile] [page-match]` and standalone source commands live under `tools/`. `tools/monitor.ts`, `tools/watch.ts`, and `tools/crash-watcher.ts` provide continuous monitoring. `tools/hue-bench.ts` compares idle frames with a theme sweep and reports per-thread costs. The `tools/probes/` and `tools/experiments/` directories contain application-specific timing, game, extension, and Windows process-memory probes.

```sh
npm ci
npm run check
npm run build
npm test
npm pack
```

The integration tests launch Chrome against local fixtures and check real diagnostic files and CLI failures. The CI workflow targets Windows, Linux, and macOS.

