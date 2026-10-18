// Usage: PLAYWRIGHT_MODULE=<playwright index.mjs> node web-cold-host-check.mjs <website dir>
// Website sign-in against an API that never answers: a /health wake-up is sent
// on load, and a sign-in call ends in the "timeout" message (timer shortened).
import http from "node:http";
import { readFile } from "node:fs/promises";
const playwright = await import(process.env.PLAYWRIGHT_MODULE);
const [websiteDir] = process.argv.slice(2);
const seen = [];
const api = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" });
    res.end();
  }
  // Every other request hangs, like a host that is asleep.
}).listen(0, "127.0.0.1");
await new Promise((r) => api.once("listening", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const site = http.createServer(async (req, res) => {
  const js = await readFile(`${websiteDir}/js/account-auth.js`, "utf8");
  if (req.url === "/js/account-auth.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(js); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta name="movenrun-api" content="${apiUrl}"><script>
    const real = window.setTimeout; window.setTimeout = (fn, ms, ...a) => real(fn, ms === 90000 ? 200 : ms, ...a);
  </script><script src="/js/account-auth.js"></script>`);
}).listen(0, "127.0.0.1");
await new Promise((r) => site.once("listening", r));
const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${site.address().port}/`);
const result = await page.evaluate(async () => {
  try { await window.MovenRunAuth.apiPost("/identity/auth/wallet/begin", { address: "0x0" }); return "resolved"; }
  catch (e) { return { code: e.code, text: window.MovenRunAuth.message(e) }; }
});
await browser.close();
api.closeAllConnections(); api.close(); site.close();
const checks = [
  ["wake-up GET /health sent on load", seen.includes("GET /health")],
  ["hanging sign-in call ends with code timeout", result.code === "timeout"],
  ["timeout has its own retry message", /starting up; please try again/.test(result.text)],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(JSON.stringify({ seen, result }));
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
