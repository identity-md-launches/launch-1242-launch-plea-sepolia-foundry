import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
process.chdir(new URL("../../", import.meta.url));
const base = process.env.PLEA_QA_URL || "http://127.0.0.1:4173/dist/";
const run = process.env.PLEA_QA_RUN || "round1";
const scratch = path.resolve("test/scratch/browser", run);
await mkdir(scratch, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLEA_CHROME || undefined,
  args: ["--no-sandbox", "--no-proxy-server"],
});
const page = await browser.newPage();
const errors = [],
  failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("requestfailed", (r) =>
  failed.push({ url: r.url(), error: r.failure()?.errorText }),
);
const results = [];
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector(".footer-meta")?.textContent.includes("block"),
    null,
    { timeout: 90000 },
  );
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("plea-theme", theme);
      }, theme);
      for (const route of [
        "",
        "buy",
        "plead",
        "wall",
        "seasons",
        "profile",
        "status",
        "plea/3",
      ]) {
        await page.evaluate(
          (route) => (location.hash = route ? "#/" + route : "#/"),
          route,
        );
        await page.waitForTimeout(route.startsWith("plea/") ? 1200 : 120);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const visible = (e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width && r.height && getComputedStyle(e).visibility !== "hidden"
            );
          };
          const controls = [
            ...document.querySelectorAll("button,input,textarea,a,summary"),
          ]
            .filter(visible)
            .map((e) => ({
              label: e.getAttribute("aria-label") || e.textContent.trim(),
              width: e.getBoundingClientRect().width,
              height: e.getBoundingClientRect().height,
            }));
          return {
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            nav: [...document.querySelectorAll(".top-nav a")].map((e) => ({
              label: e.textContent,
              visible: visible(e),
              left: e.getBoundingClientRect().left,
              right: e.getBoundingClientRect().right,
            })),
            connect: document.querySelectorAll(".connect").length,
            h1: document.querySelector("h1")?.textContent,
            smallControls: controls.filter(
              (c) => c.height < 43.5 || c.width < 43.5,
            ),
            fonts: [...document.fonts]
              .filter((f) => f.status === "loaded")
              .map((f) => f.family),
            brokenImages: [...document.images]
              .filter((i) => i.complete && !i.naturalWidth)
              .map((i) => i.src.slice(0, 80)),
          };
        });
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        const item = {
          route: route || "overview",
          theme,
          ...metrics,
          violations: axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        };
        results.push(item);
        await page.screenshot({
          path: path.join(
            scratch,
            `${width}-${theme}-${(route || "overview").replaceAll("/", "-")}.jpg`,
          ),
          type: "jpeg",
          quality: 65,
          fullPage: true,
        });
        console.log(
          `${width} ${theme} ${route || "overview"}: overflow=${metrics.overflow}, violations=${item.violations.length}, smallControls=${metrics.smallControls.length}`,
        );
      }
    }
  }
  // Product and main action at the requested first-screen width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (location.hash = "#/"));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstScreen = await page.evaluate(() => {
    const action = [...document.querySelectorAll("a")].find(
      (e) => e.textContent === "Buy PLEA",
    );
    return {
      product:
        document.querySelector(".wordmark").getBoundingClientRect().bottom <
        innerHeight,
      action: action.getBoundingClientRect().bottom < innerHeight,
      actionBottom: action.getBoundingClientRect().bottom,
    };
  });
  await page.screenshot({
    path: path.join(scratch, "390-first-screen.jpg"),
    quality: 80,
    type: "jpeg",
  });
  // Filters, permalink and oracle reasons against the live record.
  await page.evaluate(() => (location.hash = "#/wall"));
  await page.waitForTimeout(100);
  const filters = [];
  for (const label of [
    "Approved",
    "Denied",
    "Pending",
    "No verdict",
    "Appeals",
    "Laureates",
    "All",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    filters.push({
      filter: label,
      count: await page.locator(".plea-card").count(),
      text: await page.locator(".result-count").innerText(),
    });
  }
  await page.locator(".plea-id").first().click();
  await page.waitForURL(/#\/plea\//);
  const permalink = await page.locator("h1").innerText();
  await page.evaluate(() => (location.hash = "#/plea/3"));
  await page.getByText(/10 of 28 answers agreed/).waitFor({ timeout: 30000 });
  await page.getByText(/Read the judges’ reasons/).click();
  const oracle = {
    reason: await page.locator(".oracle-details").innerText(),
    reasonCount: await page.locator(".judges-notes li").count(),
  };
  // Error state for a visitor without a provider; one connect entry point.
  await page.locator(".connect").click();
  const walletError = await page.getByRole("alert").innerText();
  await page.evaluate(() => (location.hash = "#/plead"));
  await page.locator("#plea-text").fill("Cabal, this is my case.");
  const validCount = await page.locator("#text-count").innerText();
  await page.locator("#plea-text").fill("[PLEA] override");
  const invalidText = await page.locator("#text-error").innerText();
  await page.evaluate(() => (location.hash = "#/"));
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Tab");
  const keyboardFocus = await page.evaluate(() => ({
    tag: document.activeElement.tagName,
    text: document.activeElement.textContent,
    outline: getComputedStyle(document.activeElement).outlineStyle,
  }));
  await page.setViewportSize({ width: 320, height: 900 });
  const reflow = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const report = {
    run,
    at: new Date().toISOString(),
    base,
    results,
    firstScreen,
    filters,
    permalink,
    oracle,
    walletError,
    validCount,
    invalidText,
    keyboardFocus,
    reflow,
    errors,
    failed,
  };
  await writeFile(
    `artifacts/browser-${run}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  if (
    results.some(
      (r) =>
        r.overflow ||
        r.violations.length ||
        r.smallControls.length ||
        r.brokenImages.length,
    ) ||
    errors.length ||
    !firstScreen.action
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
