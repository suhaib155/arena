#!/usr/bin/env node
// Checks, from outside, that the API's rate limits are keyed by the caller's
// real address. Read only and low volume: a few GET /health calls and, with
// --write, four sign-in starts with an empty body (each answered 400, nothing
// stored, each spends one of this address's 20 per minute).
//
//   node scripts/check-client-ip.mjs https://<api-host> [requests] [--write]
//
// From one machine, every response must come from ONE bucket:
//  - RateLimit-Remaining falls by exactly one per request;
//  - a forged X-Forwarded-For or Forwarded (a new value each time) changes nothing.
// Two interleaved counters: the API keys on a proxy's address (strangers share
// a bucket). A counter that restarts with each forged value: the API trusts
// the forged header (limits can be dodged).
// Different people get different buckets when the first call from a second
// network (a phone off Wi-Fi) starts near the full limit while this one runs.
// Run it in one minute window, away from other traffic to the API.
const args = process.argv.slice(2);
const write = args.includes("--write");
const [rawBase, rawCount] = args.filter((a) => a !== "--write");
const base = (rawBase || "").replace(/\/+$/, "");
const count = Number(rawCount || 12);
if (!/^https:\/\//.test(base) || !Number.isInteger(count) || count < 4 || count > 30) {
  console.error("usage: node scripts/check-client-ip.mjs https://<api-host> [4-30 requests] [--write]");
  process.exit(2);
}

async function remaining(path, method, forged) {
  const headers = forged ? { "x-forwarded-for": forged, forwarded: `for=${forged}` } : {};
  if (method === "POST") headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: method === "POST" ? "{}" : undefined, signal: AbortSignal.timeout(90_000) });
  await res.body?.cancel();
  const value = Number(res.headers.get("ratelimit-remaining"));
  if (!Number.isFinite(value)) throw new Error(`no RateLimit-Remaining header (status ${res.status})`);
  return value;
}

async function probe(label, path, method, n) {
  const seen = [];
  // Every other request carries a different forged address.
  for (let i = 0; i < n; i++) seen.push(await remaining(path, method, i % 2 ? `203.0.113.${i}` : null));
  const steps = seen.slice(1).map((v, i) => seen[i] - v);
  const ok = steps.every((d) => d === 1);
  console.log(`${label}: RateLimit-Remaining ${seen.join(" ")} -> ${ok ? "PASS" : "FAIL"}`);
  if (!ok) {
    const forgedFresh = seen.filter((_, i) => i % 2).every((v) => v >= seen[0]);
    console.log(forgedFresh
      ? "  each forged value got a fresh bucket: the API trusts a header the client writes"
      : "  interleaved counters: the API keys on a proxy address, so strangers share buckets");
  }
  return ok;
}

let ok = await probe("global limit (GET /health)", "/health", "GET", count);
if (write) ok = (await probe("sign-in write limit (POST /identity/auth/wallet/begin)", "/identity/auth/wallet/begin", "POST", 4)) && ok;
if (!ok) {
  console.log("FAIL: set TRUST_PROXY=render-cloudflare (or fix the trusted networks) and check again.");
  process.exit(1);
}
console.log("PASS: one bucket for this caller; forged X-Forwarded-For and Forwarded are ignored.");
