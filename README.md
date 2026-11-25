# CDP Tools

Drive Chrome from the command line and get structured results for agents and CI. Replay browser interactions, capture screenshots and diagnostics, or record a performance trace and query it offline.

[Browser commands](https://cdp.ldlework.com/) · [Trace Query tutorial and reference](https://cdp.ldlework.com/trace-query/) · [Full CLI guide](site/public/guide.md)

## Install

Use Node.js 24 or newer. Browser commands also need Chrome or Chromium. Set `CHROME_PATH` if your browser is installed in a custom location.

```sh
npm install -g https://cdp.ldlework.com/cdp-tools-1.1.0.tgz
cdp version
```

## Capture an interaction

Save this as `recipe.json`, using your application's URL and selectors.

```json
{
  "version": 1,
  "url": "http://localhost:3000",
  "steps": [{ "click": "#open-results" }, { "wait": "#results.ready" }],
  "screenshot": { "element": "#results" }
}
```

```sh
cdp run recipe.json --out artifacts
```

The JSON response points to the run manifest, screenshots, and diagnostics. Agents can discover the recipe format with `cdp schema` and pass JSON on stdin with `cdp run -`.

## Investigate slow frames

```sh
cdp trace record recipe.json --preset game --out shot.json
cdp trace diagnose shot.json
cdp trace profile shot.json --limit 10 --format text
```

To try the analysis immediately after cloning, run `cdp trace diagnose examples/traces/game.json`. Trace Query also reads Chrome DevTools recordings and gzip-compressed traces.

## Develop locally

```sh
npm ci
npm run check
npm run build
npm test
npm link
```

The Vite site lives in `site/`. From the repository root, run `npm pack --pack-destination site/public` to build the CLI download, then `npm ci --prefix site`. Use `npm run dev --prefix site` for local development or `npm test --prefix site` to build and test the site in Chrome. Pushes to `main` build the download and deploy the tested site to GitHub Pages.
