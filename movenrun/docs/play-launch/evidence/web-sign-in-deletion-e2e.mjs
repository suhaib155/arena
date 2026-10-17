// End-to-end in Chromium: the public website's Google and wallet sign-in, the
// app's wallet handoff page, and web account deletion, against the built API
// and a real PostgreSQL database.
//
// Only Supabase Auth is replaced, by a local HTTPS stand-in on 127.0.0.1:443
// that publishes an ES256 signing key, runs the Google PKCE authorize/token
// steps, issues Web3 sessions and accepts admin deletions. The wallet is a real
// secp256k1 key injected as window.ethereum; it answers only
// eth_requestAccounts and personal_sign, and fails the test on anything else.
//
// Usage (run as a user that may bind port 443):
//   node web-sign-in-deletion-e2e.mjs <website dir> <backend dir> <database url> <screenshot dir>
// Playwright is not a project dependency: point PLAYWRIGHT_MODULE at an install if it is not resolvable.
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const chromium = playwright.chromium ?? playwright.default.chromium;
import http from "node:http";
import https from "node:https";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
const { default: pg } = await import(new URL("../../../node_modules/pg/lib/index.js", import.meta.url).href);
const { Wallet } = await import(new URL("../../../node_modules/ethers/lib.esm/index.js", import.meta.url).href);

const [, , site, backend, dbUrl, shots] = process.argv;
const SB = "https://127.0.0.1";
const apiPort = 4811, webPort = 4812;
const results = [];
const check = (name, ok, detail = "") => { results.push([name, ok ? "PASS" : "FAIL", detail]); console.log(ok ? "PASS" : "FAIL", name, detail); };

// ---- Supabase Auth stand-in ------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "sb-e2e-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
  "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const mint = (sub, method, email) => {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "ES256", kid: "k1", typ: "JWT" });
  const body = enc({ iss: `${SB}/auth/v1`, aud: "authenticated", role: "authenticated", sub, email, exp: now + 3600, iat: now, amr: [{ method, timestamp: now }], app_metadata: { provider: method === "oauth" ? "google" : "web3", providers: [method === "oauth" ? "google" : "web3"] }, is_anonymous: false, session_id: randomUUID() });
  return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};
const GOOGLE_SUB = randomUUID();
const flows = new Map(); // auth code -> { challenge }
const walletUsers = new Map();
const deleted = [];
const sbLog = [];
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const sbServer = https.createServer({ key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")) }, async (req, res) => {
  const url = new URL(req.url, SB);
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type", "access-control-allow-methods": "POST, GET, DELETE" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(body)); };
  sbLog.push(`${req.method} ${url.pathname}${url.searchParams.has("grant_type") ? "?grant_type=" + url.searchParams.get("grant_type") : ""}`);
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "ES256" }] });
  if (url.pathname === "/auth/v1/authorize") {
    // Stands in for Google's consent: straight back to the page with a code.
    if (url.searchParams.get("provider") !== "google" || url.searchParams.get("code_challenge_method") !== "s256") return send(400, { error: "bad_request" });
    const code = randomBytes(16).toString("hex");
    flows.set(code, { challenge: url.searchParams.get("code_challenge") });
    res.writeHead(302, { location: `${url.searchParams.get("redirect_to")}?code=${code}` }); res.end(); return;
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
    const { auth_code, code_verifier } = JSON.parse(await readBody(req));
    const flow = flows.get(auth_code);
    flows.delete(auth_code);
    if (!flow || createHash("sha256").update(code_verifier).digest("base64url") !== flow.challenge) return send(400, { error: "invalid_grant" });
    return send(200, { access_token: mint(GOOGLE_SUB, "oauth", "runner@example.com"), token_type: "bearer" });
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "web3") {
    const { message } = JSON.parse(await readBody(req));
    const address = String(message).split("\n")[1];
    if (!walletUsers.has(address)) walletUsers.set(address, randomUUID());
    return send(200, { access_token: mint(walletUsers.get(address), "web3", null) });
  }
  if (url.pathname === "/auth/v1/logout") return send(204, {});
  const admin = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (admin && req.method === "DELETE") { deleted.push(admin[1]); return send(200, {}); }
  send(404, { error: "not_found" });
}).listen(443, "127.0.0.1");

// ---- API and website -------------------------------------------------------
const api = spawn(process.execPath, ["dist/api.cjs"], {
  cwd: backend,
  env: { ...process.env, NODE_ENV: "production", PORT: String(apiPort), DATABASE_URL: dbUrl, NODE_EXTRA_CA_CERTS: join(dir, "cert.pem"),
    IDENTITY_SESSION_PEPPER: "s".repeat(40), CORS_ORIGINS: "https://movenrun.xyz", IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
    SUPABASE_URL: SB, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e", SUPABASE_SECRET_KEY: "sb_secret_e2e" },
  stdio: "inherit",
});
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://127.0.0.1:${apiPort}/ready`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
// Pages are served with the Content-Security-Policy from vercel.json, with the
// hosted API and Supabase origins swapped for the local stand-ins, so any
// script, style or connection the policy would block fails this run.
const vercel = JSON.parse(await readFile(join(site, "vercel.json"), "utf8"));
const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value
  .replace("https://movenrun-staging-api.onrender.com", "")
  .replace("https://tavxmwuwkeynbnzfwove.supabase.co", SB)
  .replace(/; upgrade-insecure-requests/, "");
const cspViolations = [];
// Same-origin proxy for /identity, standing in for the hosted API's CORS.
const web = http.createServer(async (req, res) => {
  if (req.url.startsWith("/identity/")) {
    const body = await readBody(req);
    const up = await fetch(`http://127.0.0.1:${apiPort}${req.url}`, { method: req.method, headers: { "content-type": "application/json", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: req.method === "GET" ? undefined : body });
    res.writeHead(up.status, { "content-type": "application/json" }); res.end(await up.text()); return;
  }
  let path = join(site, decodeURIComponent(req.url.split("?")[0]));
  if (path.endsWith("/")) path += "index.html";
  try {
    let text = await readFile(path, "utf8");
    if (path.endsWith(".html")) {
      // The pages carry the real API origin (or, in older commits, a placeholder);
      // both are pointed at the local API so nothing reaches the deployed one.
      text = text.replace(/\{\{API_BASE_URL\}\}|https:\/\/movenrun-staging-api\.onrender\.com/g, `http://127.0.0.1:${webPort}`)
        .replace("https://tavxmwuwkeynbnzfwove.supabase.co", SB)
        .replace("{{SUPABASE_PUBLISHABLE_KEY}}", "sb_publishable_e2e");
    }
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", ...(path.endsWith(".html") ? { "content-security-policy": csp } : {}) }); res.end(text);
  } catch { res.writeHead(404); res.end(); }
}).listen(webPort, "127.0.0.1");

const db = new pg.Pool({ connectionString: dbUrl });
const browser = await chromium.launch();
const watchCsp = (page) => page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
const newContext = browser.newContext.bind(browser);
browser.newContext = async (...a) => { const c = await newContext(...a); c.on("page", watchCsp); return c; };
const newPage = browser.newPage.bind(browser);
browser.newPage = async (...a) => { const p = await newPage(...a); watchCsp(p); return p; };
const count = async (sql, args = []) => (await db.query(sql, args)).rows[0].c;
const verifyMovement = (token, sessionId) => {
  const start = Date.now() - 180000;
  return fetch(`http://127.0.0.1:${apiPort}/movement/verify`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, startTime: start, endTime: start + 120000, points: Array.from({ length: 121 }, (_, i) => ({ lat: 12.9716 + i * 0.000016, lng: 77.5946, accuracy: 5, timestamp: start + i * 1000 })) }) });
};

async function walletPage(wallet) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const asked = [];
  await page.exposeFunction("__walletRequest", async (method, params) => {
    asked.push(method);
    if (method === "eth_requestAccounts") return [wallet.address];
    if (method === "personal_sign") {
      if (params[1] !== wallet.address) throw new Error("wrong account");
      return wallet.signMessage(Buffer.from(params[0].slice(2), "hex").toString("utf8"));
    }
    throw new Error(`the page asked the wallet for ${method}`);
  });
  await page.addInitScript(() => { window.ethereum = { request: ({ method, params }) => window.__walletRequest(method, params) }; });
  return { page, context, asked };
}

try {
  // 1. Google on the deletion page: an account created the way the app would,
  //    then deleted from the web after signing in with Google there.
  const gContext = await browser.newContext({ viewport: { width: 360, height: 740 }, ignoreHTTPSErrors: true });
  const gPage = await gContext.newPage();
  const created = await (await fetch(`http://127.0.0.1:${apiPort}/identity/auth/google/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: mint(GOOGLE_SUB, "oauth", "runner@example.com") }) })).json();
  const appToken = created.session?.accessToken;
  if (!appToken) throw new Error(`sign-in through the API failed: ${JSON.stringify(created)}; provider calls: ${sbLog.join(", ")}`);
  check("google account created through the API", Boolean(appToken));
  check("google account verified movement", (await verifyMovement(appToken, "web-e2e-google")).status === 201);
  await gPage.goto(`http://127.0.0.1:${webPort}/account-deletion/`);
  await gPage.click("#google");
  await gPage.waitForSelector("#step-confirm:not([hidden])");
  check("google return lands on the confirm step, code stripped from the URL", !gPage.url().includes("code="), gPage.url());
  await gPage.screenshot({ path: join(shots, "web-delete-google-confirm.png") });
  await gPage.click("#step-confirm button");
  await gPage.waitForSelector("#status.ok");
  check("google account deleted from the web", (await gPage.textContent("#status")).includes("deleted"));
  await gPage.screenshot({ path: join(shots, "web-delete-google-done.png") });
  check("google identity gone", (await count("select count(*)::int c from auth_identities where provider_subject=$1", [GOOGLE_SUB])) === 0);
  check("google movement rows gone", (await count("select count(*)::int c from movement_verifications where client_session_id='web-e2e-google'")) === 0);
  check("app token dead after web deletion", (await fetch(`http://127.0.0.1:${apiPort}/identity/me`, { headers: { authorization: `Bearer ${appToken}` } })).status === 401);
  check("google user removed at the provider", deleted.includes(GOOGLE_SUB));

  // 2. Wallet on the deletion page, for an account with no email at all.
  const owner = Wallet.createRandom();
  const w = await walletPage(owner);
  await w.page.goto(`http://127.0.0.1:${webPort}/account-deletion/`);
  await w.page.click("#wallet");
  await w.page.waitForSelector("#step-confirm:not([hidden])");
  const walletSubject = walletUsers.get(owner.address);
  check("wallet-only account exists without an email", (await count("select count(*)::int c from users u join auth_identities i on i.user_id=u.id where i.provider_subject=$1 and i.normalized_email is null", [walletSubject])) === 1);
  await w.page.screenshot({ path: join(shots, "web-delete-wallet-confirm.png") });
  await w.page.click("#step-confirm button");
  await w.page.waitForSelector("#status.ok");
  check("wallet account deleted from the web", (await count("select count(*)::int c from auth_identities where provider_subject=$1", [walletSubject])) === 0);
  check("wallet user removed at the provider", deleted.includes(walletSubject));
  check("the page asked the wallet only to connect and sign", w.asked.join(",") === "eth_requestAccounts,personal_sign", w.asked.join(","));

  // 3. The app's wallet handoff page: the code works only with the app's verifier.
  const runner = Wallet.createRandom();
  const h = await walletPage(runner);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await h.page.goto(`http://127.0.0.1:${webPort}/sign-in/?app=android&challenge=${challenge}`);
  await h.page.click("#sign");
  await h.page.waitForSelector("#step-done:not([hidden])");
  const shown = (await h.page.textContent("#code")).replace(/\s/g, "");
  const href = await h.page.getAttribute("#return", "href");
  check("handoff page shows a 12-character code", /^[A-Z2-9]{12}$/.test(shown), shown);
  check("return link goes only to the app", href === `movenrun://auth/wallet?code=${shown}`, href);
  await h.page.screenshot({ path: join(shots, "web-wallet-handoff-code.png") });
  const exchange = (v) => fetch(`http://127.0.0.1:${apiPort}/identity/auth/wallet/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: shown, codeVerifier: v }) });
  check("code refused without the app's verifier", (await exchange(randomBytes(32).toString("base64url"))).status === 401);
  const collected = await exchange(verifier);
  check("code accepted with the app's verifier", collected.status === 200);
  check("code spent once", (await exchange(verifier)).status === 401);
  const handoffPage = await browser.newPage();
  await handoffPage.goto(`http://127.0.0.1:${webPort}/sign-in/`);
  check("sign-in page without a challenge only explains", await handoffPage.isVisible("#not-from-app") && !(await handoffPage.isVisible("#from-app")));

  // 4. No horizontal overflow at 320 px on any public account page.
  for (const p of ["privacy", "account-deletion", "support", "sign-in"]) {
    const narrow = await browser.newPage({ viewport: { width: 320, height: 640 } });
    await narrow.goto(`http://127.0.0.1:${webPort}/${p}/`);
    check(`${p} fits 320px`, !(await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  }
  const home = await browser.newPage();
  await home.goto(`http://127.0.0.1:${webPort}/`, { waitUntil: "networkidle" });
  for (const p of ["privacy", "support", "docs"]) await home.goto(`http://127.0.0.1:${webPort}/${p}/`, { waitUntil: "networkidle" });
  check("no Content-Security-Policy violations on any page visited", cspViolations.length === 0, cspViolations.slice(0, 3).join(" | "));
  check("provider calls seen", true, [...new Set(sbLog)].join(" | "));
} catch (error) {
  // A step that throws is a failure, never a shorter passing run.
  check("run completed", false, String(error?.message ?? error).slice(0, 200));
} finally {
  console.log(JSON.stringify(results, null, 1));
  const failed = results.filter((r) => r[1] === "FAIL").length;
  console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
  await browser.close(); web.close(); sbServer.close(); api.kill(); await db.end();
  process.exitCode = failed ? 1 : 0;
}
