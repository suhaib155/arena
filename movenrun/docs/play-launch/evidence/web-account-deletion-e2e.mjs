// End-to-end: public deletion page in Chromium → same-origin proxy → built API → PostgreSQL.
// Playwright is not a project dependency: point PLAYWRIGHT_MODULE at an install if it is not resolvable.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
const { default: pg } = await import(new URL("../../../node_modules/pg/lib/index.js", import.meta.url).href);

const [, , site, backend, dbUrl] = process.argv;
const REVIEW = { email: "play-review@movenrun.test", code: "730518" };
const apiPort = 4811, webPort = 4812;
const api = spawn(process.execPath, ["dist/api.cjs"], {
  cwd: backend,
  env: { ...process.env, NODE_ENV: "production", PORT: String(apiPort), DATABASE_URL: dbUrl,
    IDENTITY_SESSION_PEPPER: "s".repeat(40), IDENTITY_OTP_PEPPER: "o".repeat(40),
    CORS_ORIGINS: "https://movenrun-website.vercel.app", RESEND_API_KEY: "re_unused_in_review_path",
    IDENTITY_EMAIL_FROM: "signin@movenrun.test", IDENTITY_REVIEW_EMAIL: REVIEW.email, IDENTITY_REVIEW_CODE: REVIEW.code },
  stdio: "inherit",
});
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/ready`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 100));
}
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const web = http.createServer(async (req, res) => {
  if (req.url.startsWith("/identity/")) {
    const body = await new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => r(b)); });
    const up = await fetch(`http://127.0.0.1:${apiPort}${req.url}`, { method: req.method, headers: { "content-type": "application/json", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: req.method === "GET" ? undefined : body });
    res.writeHead(up.status, { "content-type": "application/json" }); res.end(await up.text()); return;
  }
  let path = join(site, decodeURIComponent(req.url.split("?")[0]));
  if (path.endsWith("/")) path += "index.html";
  try {
    let html = await readFile(path, "utf8");
    if (path.endsWith("account-deletion/index.html")) html = html.replace("{{API_BASE_URL}}", `http://127.0.0.1:${webPort}`);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }); res.end(html);
  } catch { res.writeHead(404); res.end(); }
}).listen(webPort, "127.0.0.1");

const db = new pg.Pool({ connectionString: dbUrl });
const results = [];
const browser = await chromium.launch();
try {
  // Create the account and a verified session through the API first, the way the app would.
  const begin = await fetch(`http://127.0.0.1:${apiPort}/identity/auth/email/begin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: REVIEW.email }) });
  results.push(["review begin", begin.status]);
  const done = await (await fetch(`http://127.0.0.1:${apiPort}/identity/auth/email/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: REVIEW.email, code: REVIEW.code }) })).json();
  const token = done.session.accessToken;
  const start = Date.now() - 180000;
  const v = await fetch(`http://127.0.0.1:${apiPort}/movement/verify`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: "web-delete-e2e", startTime: start, endTime: start + 120000, points: Array.from({ length: 121 }, (_, i) => ({ lat: 12.9716 + i * 0.000016, lng: 77.5946, accuracy: 5, timestamp: start + i * 1000 })) }) });
  results.push(["movement verify", v.status]);
  const before = (await db.query("select count(*)::int c from users")).rows[0].c;

  // Wait out the resend cooldown so the page can request a fresh code.
  await new Promise(r => setTimeout(r, 31000));
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await page.goto(`http://127.0.0.1:${webPort}/account-deletion/`);
  await page.fill("#email", REVIEW.email);
  await page.click("#step-email button");
  await page.waitForSelector("#step-code:not([hidden])");
  await page.fill("#code", REVIEW.code);
  await page.click("#step-code button");
  await page.waitForSelector("#step-confirm:not([hidden])");
  await page.screenshot({ path: process.argv[5] + "/web-deletion-confirm.png", fullPage: false });
  await page.click("#step-confirm button");
  await page.waitForSelector("#status.ok");
  results.push(["page status", await page.textContent("#status")]);
  await page.screenshot({ path: process.argv[5] + "/web-deletion-done.png", fullPage: false });

  results.push(["users before/after", `${before}/${(await db.query("select count(*)::int c from users")).rows[0].c}`]);
  results.push(["identities for email", (await db.query("select count(*)::int c from auth_identities where provider_subject=$1", [REVIEW.email])).rows[0].c]);
  results.push(["movement rows for e2e session", (await db.query("select count(*)::int c from movement_verifications where client_session_id='web-delete-e2e'")).rows[0].c]);
  results.push(["old token after delete", (await fetch(`http://127.0.0.1:${apiPort}/identity/me`, { headers: { authorization: `Bearer ${token}` } })).status]);
  results.push(["anonymous deletion events", (await db.query("select count(*)::int c from security_audit_events where event_type='account_deleted' and user_id is null")).rows[0].c]);
  // Horizontal overflow at 320 px on every policy page.
  for (const p of ["privacy", "account-deletion", "support"]) {
    const narrow = await browser.newPage({ viewport: { width: 320, height: 640 } });
    await narrow.goto(`http://127.0.0.1:${webPort}/${p}/`);
    results.push([`${p} overflow at 320px`, await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)]);
  }
} finally {
  console.log(JSON.stringify(results, null, 1));
  await browser.close(); web.close(); api.kill(); await db.end();
}
