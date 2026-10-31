// Website checks for the public policy pages that Google Play links to.
// Plain Node (node --test), no dependencies, no network.
//   node --test movenrun/website/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(site, p), "utf8");
const require = createRequire(import.meta.url);
const { deletionOutcome, endsRequest, TEXT } = require(join(site, "js", "deletion-outcome.js"));

const POLICY_PAGES = ["privacy", "account-deletion", "support", "sign-in"];
const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ");

// ---- deletion outcome: the wording follows what the server confirmed ----------

test("current server, 200 with the sign-in record removed: complete", () => {
  const o = deletionOutcome(200, { deleted: true, erased: {}, signInRecord: "removed" });
  assert.equal(o.done, true);
  assert.equal(o.text, TEXT.complete);
});

test("current server, 200 with no sign-in record to remove: complete", () => {
  const o = deletionOutcome(200, { deleted: true, erased: {}, signInRecord: "none" });
  assert.equal(o.done, true);
  assert.equal(o.text, TEXT.completeNoRecord);
});

test("200 with the sign-in record still pending: requested, never complete", () => {
  const o = deletionOutcome(200, { deleted: true, signInRecord: "pending" });
  assert.equal(o.done, false);
  assert.match(o.text, /^Deletion requested\./);
  assert.doesNotMatch(o.text, /complete\./i);
});

test("queued server, 200 completed and removed: complete", () => {
  assert.equal(deletionOutcome(200, { deleted: true, status: "completed", signInRecord: "removed" }).done, true);
});

test("queued server, 202 pending: requested", () => {
  const o = deletionOutcome(202, { deleted: false, status: "pending", requestId: "r", signedOut: true, signInRecord: "pending" });
  assert.equal(o.done, false);
  assert.equal(o.text, TEXT.requested);
});

test("a 2xx that does not confirm completion is never reported as complete", () => {
  for (const body of [
    null,
    "deleted",
    {},
    { deleted: true },
    { deleted: "true", signInRecord: "removed" },
    { deleted: true, status: "pending", signInRecord: "removed" },
    { deleted: true, status: "queued", signInRecord: "none" },
    { deleted: true, signInRecord: "REMOVED" },
  ]) {
    const o = deletionOutcome(200, body);
    assert.equal(o.done, false, JSON.stringify(body));
    assert.match(o.text, /^Deletion requested\./);
  }
});

test("409, 503 and other errors never claim deletion", () => {
  assert.equal(deletionOutcome(409, { error: "account_deletion_pending" }).text, TEXT.pending);
  assert.match(deletionOutcome(503, { error: "deletion_busy" }).text, /nothing was deleted/);
  for (const s of [400, 401, 403, 404, 429, 500, 502]) {
    const o = deletionOutcome(s, null);
    assert.equal(o.kind, "error");
    assert.equal(o.done, false);
    assert.match(o.text, /Nothing was confirmed as deleted/);
  }
});

test("the request ends (token dropped, form hidden) only on 2xx or 409", () => {
  assert.equal(endsRequest(200), true);
  assert.equal(endsRequest(202), true);
  assert.equal(endsRequest(409), true);
  for (const s of [400, 401, 429, 500, 503]) assert.equal(endsRequest(s), false);
});

// ---- the page script, wired to a fake DOM -------------------------------------

function runDeletionPage({ status, body, jsonThrows = false, rejects = false }) {
  const el = (id) => ({ id, hidden: false, disabled: false, textContent: "", className: "", listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, querySelector() { return button; } });
  const button = el("confirm-button");
  const nodes = Object.fromEntries(["status", "step-sign-in", "step-confirm", "google", "wallet", "wallet-choice"].map((id) => [id, el(id)]));
  nodes["step-confirm"].hidden = true;
  const posts = [];
  const auth = {
    apiReady: true, googleReady: true,
    finishGoogle: () => Promise.resolve("token-123"),
    startGoogle: () => Promise.resolve(),
    signInWithWallet: () => Promise.resolve("token-123"),
    message: () => "error",
    apiPost(path, payload, token) {
      posts.push({ path, payload, token });
      if (rejects) return Promise.reject(new Error("network"));
      return Promise.resolve({ status, ok: status >= 200 && status < 300,
        json: () => (jsonThrows ? Promise.reject(new Error("bad json")) : Promise.resolve(body)) });
    },
  };
  const window = { MovenRunAuth: auth };
  const ctx = { window, document: { getElementById: (id) => nodes[id] }, module: undefined };
  vm.createContext(ctx);
  vm.runInContext(read("js/deletion-outcome.js"), ctx);
  vm.runInContext(read("js/account-deletion-page.js"), ctx);
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    nodes, posts, button,
    async submit() {
      await tick(); await tick();
      nodes["step-confirm"].listeners.submit({ preventDefault() {} });
      for (let i = 0; i < 5; i++) await tick();
    },
  };
}

test("page: current server success with sign-in record removed says complete and ends the request", async () => {
  const p = runDeletionPage({ status: 200, body: { deleted: true, signInRecord: "removed" } });
  await p.submit();
  assert.deepEqual(p.posts.map((x) => [x.path, x.payload.confirm, x.token]), [["/identity/account/delete", "DELETE", "token-123"]]);
  assert.equal(p.nodes.status.textContent, TEXT.complete);
  assert.equal(p.nodes["step-confirm"].hidden, true);
  assert.equal(p.button.disabled, false);
});

test("page: sign-in record pending says requested, not deleted", async () => {
  const p = runDeletionPage({ status: 200, body: { deleted: true, signInRecord: "pending" } });
  await p.submit();
  assert.equal(p.nodes.status.textContent, TEXT.requestedRecordPending);
});

test("page: 202 says requested", async () => {
  const p = runDeletionPage({ status: 202, body: { deleted: false, status: "pending" } });
  await p.submit();
  assert.equal(p.nodes.status.textContent, TEXT.requested);
  assert.equal(p.nodes["step-confirm"].hidden, true);
});

test("page: a 200 with an unreadable body says requested, not deleted", async () => {
  const p = runDeletionPage({ status: 200, jsonThrows: true });
  await p.submit();
  assert.equal(p.nodes.status.textContent, TEXT.requested);
});

test("page: 503 keeps the form so the person can retry, and says nothing was deleted", async () => {
  const p = runDeletionPage({ status: 503, body: { error: "deletion_busy" } });
  await p.submit();
  assert.equal(p.nodes.status.textContent, TEXT.busy);
  assert.equal(p.nodes["step-confirm"].hidden, false);
  assert.equal(p.nodes.status.className, "status error");
});

test("page: network failure says nothing was confirmed as deleted", async () => {
  const p = runDeletionPage({ rejects: true });
  await p.submit();
  assert.match(p.nodes.status.textContent, /Nothing was confirmed as deleted/);
  assert.equal(p.button.disabled, false);
});

// ---- public copy: no claims the service cannot back --------------------------

const FORBIDDEN = [
  [/permanently delet/i, "permanent deletion claim"],
  [/(happens|deleted|removed) (immediately|straight away|instantly)/i, "instant deletion claim"],
  [/delete[s]? your account straight away/i, "instant deletion claim"],
  [/no (automatic |provider )?backups/i, "absolute no-backup claim"],
  [/does not live on in a backup/i, "absolute no-backup claim"],
  [/within 30 days/i, "deletion time promise"],
  [/coarse map cells/i, "downplays stored location cells"],
  [/we will delete it/i, "unconditional deletion promise"],
  [/have been deleted\./i, "unconditional deletion message"],
  [/within \d+ (working )?days/i, "support response promise"],
];

for (const page of POLICY_PAGES) {
  test(`${page}: no unsupported deletion, backup or time-frame claims`, () => {
    const text = visibleText(read(`${page}/index.html`));
    for (const [re, why] of FORBIDDEN) assert.doesNotMatch(text, re, `${page}: ${why}`);
  });
}

test("deletion page script messages make no unsupported claims either", () => {
  const all = Object.values(TEXT).join(" ") + " " + read("js/account-deletion-page.js");
  for (const [re, why] of FORBIDDEN) assert.doesNotMatch(all, re, why);
});

test("privacy policy discloses the stored map cells as location data and the Maps SDK's own collection", () => {
  const text = visibleText(read("privacy/index.html"));
  assert.match(text, /about 0\.7 km² each; together they show approximately where you moved, so we treat them as location data/);
  assert.match(text, /Google Maps SDK for Android/);
  assert.match(text, /crash reports and stack traces from the SDK's own code/);
  assert.match(text, /pseudonymous identifier specific to the Maps SDK/);
  assert.doesNotMatch(text, /no third-party analytics or crash-reporting SDKs/);
});

test("privacy policy keeps the facts Play's declarations rely on", () => {
  const text = visibleText(read("privacy/index.html"));
  assert.match(text, /package io\.movenrun\.app/);
  assert.match(text, /only while the app is open/);
  assert.match(text, /never tracks you in the background/);
  assert.match(text, /no purchases, no payouts, no tokens and no digital ownership/);
  assert.match(text, /We do not sell your data, show ads, or use advertising or analytics trackers/);
});

// ---- reachability, structure and accessibility --------------------------------

for (const page of POLICY_PAGES) {
  test(`${page}: works signed out, under the site CSP, and is accessible`, () => {
    const html = read(`${page}/index.html`);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width/);
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main id="main">/);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, "exactly one h1");
    // script-src 'self': inline scripts would be blocked on the live site.
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, "no inline script");
    assert.doesNotMatch(html, /\son[a-z]+="/i, "no inline event handlers");
    for (const src of html.match(/<script src="([^"]+)"/g) ?? []) {
      const path = src.match(/src="\/?([^"]+)"/)[1];
      assert.ok(existsSync(join(site, path)), `${page}: missing ${path}`);
    }
    for (const href of ["/privacy/", "/account-deletion/", "/support/", "mailto:info@movenrun.xyz"]) {
      assert.ok(html.includes(`href="${href}`), `${page}: no link to ${href}`);
    }
  });
}

test("deletion page loads the outcome rules before the page script, and announces status", () => {
  const html = read("account-deletion/index.html");
  const a = html.indexOf('src="/js/deletion-outcome.js"');
  const b = html.indexOf('src="/js/account-deletion-page.js"');
  assert.ok(a > 0 && b > a);
  assert.match(html, /id="status" role="status" aria-live="polite"/);
});

test("home page links to the privacy policy, deletion and support pages", () => {
  const html = read("index.html");
  for (const href of ["/privacy/", "/account-deletion/", "/support/", "mailto:info@movenrun.xyz"]) {
    assert.ok(html.includes(`href="${href}"`), `home: no link to ${href}`);
  }
});

test("sitemap lists the three policy pages", () => {
  const xml = read("sitemap.xml");
  for (const p of ["privacy", "account-deletion", "support"]) assert.ok(xml.includes(`https://movenrun.xyz/${p}/`));
});

test("vercel config keeps the strict CSP and the API origin the deletion page calls", () => {
  const cfg = JSON.parse(read("vercel.json"));
  const csp = cfg.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self';/);
  const api = read("account-deletion/index.html").match(/<meta name="movenrun-api" content="([^"]+)"/)[1];
  assert.ok(csp.includes(api), "CSP connect-src allows the API origin");
});
