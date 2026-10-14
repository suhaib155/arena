// W1 review preview of the website: full-page screenshots and a responsiveness
// matrix, from a locally served copy of movenrun/website. Nothing is published.
// Only 127.0.0.1 and Google Fonts may load; every other request is blocked and listed.
//
// Usage:
//   PLAYWRIGHT_MODULE=<playwright index.mjs> node website-w1-shots.mjs <base url> <out dir> <label> [--matrix]
//   label: "before" or "after" (file name prefix). --matrix also writes <out dir>/<label>-matrix.json.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import { writeFile, mkdir } from "node:fs/promises";

const [, , base, out, label = "after", ...flags] = process.argv;
const withMatrix = flags.includes("--matrix");
await mkdir(out, { recursive: true });

const pages = [
  ["home", "/"],
  ["privacy", "/privacy/"],
  ["support", "/support/"],
  ["account-deletion", "/account-deletion/"],
  ["sign-in", "/sign-in/?app=android&challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ["docs", "/docs/"],
  ["docs-capture", "/docs/capture/"],
  ["docs-roadmap", "/docs/roadmap/"],
];

const browser = await chromium.launch();

async function open(ctx, path) {
  const page = await ctx.newPage();
  const blocked = [], errors = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === "data:" || u.hostname === "127.0.0.1" || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") return route.continue();
    blocked.push(u.origin + u.pathname); return route.abort();
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  await page.goto(base + path, { waitUntil: "networkidle" });
  return { page, blocked, errors };
}

// Scroll top to bottom in steps so reveal observers fire, then return to the top.
async function scrollThrough(page, checkOverflow) {
  let overflowAt = null;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = await page.evaluate(() => innerHeight);
  for (let y = 0; y <= height; y += Math.round(vh * 0.6)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(90);
    if (checkOverflow && overflowAt === null) {
      const o = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (o) overflowAt = y;
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return overflowAt;
}

// ---- Screenshots ----------------------------------------------------------
const shotSizes = [[1440, 900, 1], [390, 844, 2]];
const homeExtra = label === "after" ? [[320, 700, 2], [360, 780, 2], [768, 1024, 1], [1024, 768, 1]] : [];
const shotLog = [];
async function shoot(name, path, w, h, dpr) {
  const mobile = w < 720;
  // Full-page captures use reduced motion so every reveal and sticky scene is settled.
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  const { page, blocked, errors } = await open(ctx, path);
  await scrollThrough(page, false);
  await page.waitForTimeout(600);
  const file = `${out}/${label}-${name}-${w}.png`;
  await page.screenshot({ path: file, fullPage: true });
  shotLog.push({ file, blocked, errors });
  await ctx.close();
}
for (const [w, h, dpr] of shotSizes) for (const [name, path] of pages) await shoot(name, path, w, h, dpr);
for (const [w, h, dpr] of homeExtra) await shoot("home", "/", w, h, dpr);

// ---- Responsiveness matrix -------------------------------------------------
const matrix = [];
if (withMatrix) {
  const widths = [320, 360, 390, 768, 1024, 1440];
  const targets = {
    home: [".nav-brand", ".nav-mobile summary", ".btn-nav", ".hero-ctas a", ".final-ctas a", "#mobileCta a"],
    docs: [".dnav-toggle", ".dsearch-btn", ".dbrand"],
    legal: ["header a.brand", "nav.links a", "button:not([hidden])", "a.button"],
  };
  const kindOf = (name) => name === "home" ? "home" : name.startsWith("docs") ? "docs" : "legal";
  for (const width of widths) {
    for (const [name, path] of pages) {
      const mobile = width < 720;
      const ctx = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile });
      const { page, blocked, errors } = await open(ctx, path);
      await page.waitForTimeout(name === "home" ? 900 : 200);
      const overflowAt = await scrollThrough(page, true);
      // Touch targets: visible primary nav / CTA elements smaller than 44px in either dimension.
      const small = mobile ? await page.evaluate((sels) => {
        const bad = [];
        for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none") continue;
          if (el.closest("[hidden]") || el.closest(".mobile-cta:not(.show)")) continue;
          if (r.height < 44 || r.width < 44) bad.push(`${sel} "${(el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return bad;
      }, targets[kindOf(name)]) : [];
      // Keyboard: Tab five times; each focused element must show an outline or box-shadow.
      const focus = [];
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        focus.push(await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return "body";
          const cs = getComputedStyle(el);
          const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
          return (visible ? "ok " : "NO-FOCUS-STYLE ") + el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
        }));
      }
      matrix.push({ width, page: name, overflow: overflowAt !== null, overflowAt, consoleErrors: errors, blocked, smallTargets: small, focus });
      await ctx.close();
    }
  }
  // 1440 with 200% text size (root font-size), and 1440 at 200% browser zoom,
  // which a browser lays out as a 720 CSS px viewport at device scale 2.
  for (const mode of ["text200", "zoom200"]) {
    for (const [name, path] of pages) {
      const ctx = await browser.newContext(mode === "zoom200" ? { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
      const { page, blocked, errors } = await open(ctx, path);
      if (mode === "text200") await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      await page.waitForTimeout(400);
      const overflowAt = await scrollThrough(page, true);
      matrix.push({ width: 1440, mode, page: name, overflow: overflowAt !== null, overflowAt, consoleErrors: errors, blocked });
      await ctx.close();
    }
  }
  // Reduced motion: no infinite CSS animation keeps running and requestAnimationFrame goes quiet.
  for (const [name, path] of pages.filter(([n]) => n === "home" || n === "docs")) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => {
      window.__raf = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };
    });
    const { page, errors } = await open(ctx, path);
    await scrollThrough(page, false);
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => window.__raf);
    await page.waitForTimeout(1500);
    const result = await page.evaluate((b) => ({
      rafPerSecondIdle: Math.round((window.__raf - b) / 1.5),
      infiniteAnimations: document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.getTiming().iterations === Infinity).length,
    }), before);
    matrix.push({ width: 1440, mode: "reduced-motion", page: name, ...result, consoleErrors: errors });
    await ctx.close();
  }
  await writeFile(`${out}/${label}-matrix.json`, JSON.stringify(matrix, null, 1));
}

await browser.close();
const errorsSeen = shotLog.filter((s) => s.errors.length || s.blocked.length);
console.log(JSON.stringify({ screenshots: shotLog.length, withErrorsOrBlocked: errorsSeen, matrixRows: matrix.length,
  overflowRows: matrix.filter((r) => r.overflow).map((r) => `${r.page}@${r.width}${r.mode ? "/" + r.mode : ""}`),
  errorRows: matrix.filter((r) => r.consoleErrors && r.consoleErrors.length).map((r) => `${r.page}@${r.width}: ${r.consoleErrors.join(" | ")}`),
  smallTargetRows: matrix.filter((r) => r.smallTargets && r.smallTargets.length).map((r) => `${r.page}@${r.width}: ${r.smallTargets.join("; ")}`),
  focusIssues: matrix.filter((r) => r.focus && r.focus.some((f) => f.startsWith("NO"))).map((r) => `${r.page}@${r.width}: ${r.focus.join(", ")}`),
  reducedMotion: matrix.filter((r) => r.mode === "reduced-motion") }, null, 1));
