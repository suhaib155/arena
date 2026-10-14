// Usage: PLAYWRIGHT_MODULE=<playwright index.mjs> node web-wallet-discovery-check.mjs <website dir>
// Website wallet selection (EIP-6963) and API error codes, in Chromium:
//  - two announced wallets: the person picks, and only the picked one is asked anything;
//  - one announced wallet plus a different window.ethereum: the announced one is used;
//  - no announced wallet: window.ethereum is the fallback;
//  - an API refusal shows its own message (registration_closed), not a generic one.
import http from "node:http";
import { readFile } from "node:fs/promises";
const playwright = await import(process.env.PLAYWRIGHT_MODULE);
const [websiteDir] = process.argv.slice(2);
let completeAnswer = { status: 200, body: { session: { accessToken: "movenrun-session" } } };
const api = http.createServer((req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, GET" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => {
    if (req.url === "/identity/auth/wallet/begin") { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ message: "movenrun.xyz wants you to sign in", expiresAt: new Date().toISOString() })); return; }
    if (req.url === "/identity/auth/wallet/complete") { res.writeHead(completeAnswer.status, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(completeAnswer.body)); return; }
    res.writeHead(200, cors); res.end("{}");
  });
}).listen(0, "127.0.0.1");
await new Promise((r) => api.once("listening", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const site = http.createServer(async (req, res) => {
  if (req.url === "/js/account-auth.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(await readFile(`${websiteDir}/js/account-auth.js`, "utf8")); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta name="movenrun-api" content="${apiUrl}"><div id="chooser" hidden></div><script>
    window.calls = [];
    const wallet = (name) => ({ request: async ({ method }) => { window.calls.push(name + ":" + method);
      if (method === "eth_requestAccounts") return ["0x00000000000000000000000000000000000000aa"];
      if (method === "personal_sign") return "0x" + "11".repeat(65);
      throw new Error("unexpected " + method); } });
    const mode = new URLSearchParams(location.search).get("mode");
    if (mode !== "two-plus-global") window.ethereum = wallet("global");
    const announce = (uuid, name) => window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { uuid, name: name + "<img src=x onerror=window.xss=1>", rdns: "test." + name, icon: "data:image/svg+xml," }, provider: wallet(name) } })));
    if (mode === "two" || mode === "two-plus-global") { announce("u1", "Alpha"); announce("u2", "Beta"); }
    if (mode === "one") announce("u1", "Alpha");
  </script><script src="/js/account-auth.js"></script>`);
}).listen(0, "127.0.0.1");
await new Promise((r) => site.once("listening", r));
const base = `http://127.0.0.1:${site.address().port}/`;
const browser = await playwright.chromium.launch();
const checks = [];
const run = async (mode, pick) => {
  const page = await browser.newPage();
  await page.goto(`${base}?mode=${mode}`);
  const pending = page.evaluate(() => window.MovenRunAuth.signInWithWallet({ deviceLabel: "x", chooser: document.getElementById("chooser") })
    .then((t) => ({ token: t }), (e) => ({ code: e.code, text: window.MovenRunAuth.message(e) })));
  let options = [];
  if (pick) {
    await page.waitForSelector("#chooser button");
    options = await page.$$eval("#chooser button", (bs) => bs.map((b) => b.textContent));
    await page.click(`#chooser button:has-text("${pick}")`);
  }
  const result = await pending;
  const state = await page.evaluate(() => ({ calls: window.calls, xss: window.xss === 1, imgs: document.querySelectorAll("#chooser img").length }));
  await page.close();
  return { result, options, ...state };
};
const two = await run("two", "Beta");
checks.push(["two wallets: a chooser lists both plus Cancel", two.options.length === 3]);
checks.push(["two wallets: only the picked wallet is asked, for accounts and one personal_sign", JSON.stringify(two.calls) === JSON.stringify(["Beta:eth_requestAccounts", "Beta:personal_sign"])]);
checks.push(["announced names are shown as text, never markup", !two.xss && two.imgs === 0]);
checks.push(["two wallets: sign-in completes with the picked wallet", two.result.token === "movenrun-session"]);
const one = await run("one");
checks.push(["one announced wallet is used instead of window.ethereum", JSON.stringify(one.calls) === JSON.stringify(["Alpha:eth_requestAccounts", "Alpha:personal_sign"])]);
const none = await run("none");
checks.push(["no announced wallet: window.ethereum is the fallback", none.calls[0] === "global:eth_requestAccounts"]);
const cancelled = await run("two-plus-global", "Cancel");
checks.push(["cancelling the chooser asks no wallet anything", cancelled.calls.length === 0 && cancelled.result.code === "signature_declined"]);
completeAnswer = { status: 403, body: { error: { code: "registration_closed" } } };
const full = await run("one");
checks.push(["an API refusal shows its own message", full.result.code === "registration_closed" && /full/.test(full.result.text)]);
await browser.close();
api.close(); site.close();
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
