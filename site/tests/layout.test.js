import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { preview } from "vite";

let server;
let browser;
let origin;

before(async () => {
  server = await preview({ preview: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" });
});
after(async () => {
  try { await browser?.close(); } finally { await server?.close(); }
});

function readLayout() {
  const style = selector => {
    const element = document.querySelector(selector);
    const css = getComputedStyle(element);
    return [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight, css.letterSpacing, css.color];
  };
  const header = document.querySelector(".site-header");
  const main = document.querySelector("main");
  const ref = document.querySelector(".command-reference");
  return {
    shell: {
      links: [...header.querySelectorAll("a")].map(a => [a.textContent.trim(), a.pathname, a.hash]),
      headerHeight: header.offsetHeight,
      headerPadding: getComputedStyle(header).paddingInlineStart,
      mainPadding: getComputedStyle(main).paddingInlineStart,
      nav: style("nav a"), brand: style(".site-brand"), footer: style(".site-footer"),
      title: style("h1"), background: getComputedStyle(document.documentElement).backgroundColor,
    },
    content: ref && {
      title: style("h2"), group: style("h3"), label: style(".kicker"), lead: style(".lead"),
      syntax: style("dt code"), description: style("dd"),
      columns: getComputedStyle(ref.querySelector("dl")).gridTemplateColumns.split(" ").length,
    },
    fits: document.documentElement.scrollWidth <= innerWidth,
  };
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`site layout and type at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      const layouts = [];
      for (const route of ["", "trace-query/", "trace-query/slingshot/index.html"]) {
        await page.goto(origin + route);
        const layout = await page.evaluate(readLayout);
        assert.ok(layout.fits, route + " overflows horizontally");
        assert.ok(await page.locator(".site-header nav").isVisible(), route + " has no navigation");
        assert.equal(await page.locator("h1").count(), 1);
        layouts.push(layout);
      }
      assert.deepEqual(layouts[0].shell, layouts[1].shell);
      assert.deepEqual(layouts[0].shell, layouts[2].shell);
      assert.deepEqual(layouts[0].content, layouts[1].content);
      assert.equal(layouts[0].content.columns, width <= 760 ? 1 : 2);
    } finally { await page.close(); }
  });
}

test("navigation, playable tutorial, reference and downloads", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "Skip to content");
    await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).hash, "#main");
    await page.getByRole("navigation").getByText("Trace Query").click();
    assert.equal(await page.locator("h1").innerText(), "Why does my game stutter?");
    assert.equal(await page.locator("main > section:last-child").getAttribute("id"), "reference");
    assert.equal(await page.locator('a[href*="/recordings/"]').count(), 0);
    for (const iframe of await page.locator("iframe").all()) {
      const game = iframe.contentFrame();
      await game.locator('body[data-state="ready"]').waitFor();
      assert.equal(await game.locator(".site-header").isVisible(), false);
      await game.locator("#field").press("Space");
      await game.locator('body[data-state="flying"]').waitFor();
      assert.equal(await game.locator("#result").textContent(), "");
      assert.equal(await game.locator("#ammo .spent").count(), 1);
      const restart = game.getByRole("button", { name: "Restart game" });
      const bounds = await game.locator("#field").boundingBox();
      const button = await restart.boundingBox();
      assert.ok(button.x >= bounds.x && button.y >= bounds.y &&
        button.x + button.width <= bounds.x + bounds.width && button.y + button.height <= bounds.y + bounds.height);
      await restart.click();
      await game.locator('body[data-state="ready"]').waitFor();
      assert.equal(await game.locator("#ammo .spent").count(), 0);
    }
    await page.locator(".site-header .site-brand").click();
    assert.equal(new URL(page.url()).pathname, "/");
    for (const link of await page.locator("a[download]").all()) {
      const url = await link.getAttribute("href");
      const response = await page.request.get(new URL(url, page.url()).href);
      assert.equal(response.status(), 200);
      assert.ok((await response.body()).length > 0);
    }
  } finally { await page.close(); }
});
