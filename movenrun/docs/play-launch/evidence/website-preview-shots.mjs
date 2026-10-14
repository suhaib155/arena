// Screenshots of the website's four pages from the Git sources, served locally.
// Only localhost and Google Fonts may load; every other request is blocked and listed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const [, , base, out] = process.argv;
const pages = [
  ["privacy", "/privacy/"],
  ["support", "/support/"],
  ["account-deletion", "/account-deletion/"],
  ["sign-in", "/sign-in/?app=android&challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
];
const sizes = [["desktop", { width: 1440, height: 900 }, 1], ["mobile", { width: 390, height: 844 }, 2]];
const browser = await chromium.launch();
const report = [];
for (const [sizeName, viewport, dpr] of sizes) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: sizeName === "mobile", hasTouch: sizeName === "mobile" });
  for (const [name, path] of pages) {
    const page = await ctx.newPage();
    const blocked = [], errors = [];
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "127.0.0.1" || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com" || u.protocol === "data:") return route.continue();
      blocked.push(u.origin + u.pathname); return route.abort();
    });
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const file = `${out}/${name}-${sizeName}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const fonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family).join(","));
    report.push({ page: name, size: sizeName, height: h, horizontalScroll: hscroll, fontsLoaded: fonts, blocked, errors });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
