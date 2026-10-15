#!/usr/bin/env node
// Checks, from outside, that the API's rate limit is keyed by the caller's
// real address. Read only: it sends GET /health a few times.
//
//   node scripts/check-client-ip.mjs https://<api-host> [requests]
//
// From one machine, every response must come from ONE rate-limit bucket:
//  - RateLimit-Remaining falls by exactly one per request;
//  - a forged X-Forwarded-For (a different value each time) changes nothing.
// Two interleaved counters mean the API reads a proxy's address (TRUST_PROXY_HOPS
// too low: visitors share buckets with strangers). A counter that restarts with
// each forged value means it reads the forged one (too high: limits bypassable).
// Run it in the same minute window, away from other traffic to the API.
const base = (process.argv[2] || "").replace(/\/+$/, "");
const count = Number(process.argv[3] || 12);
if (!/^https:\/\//.test(base) || !Number.isInteger(count) || count < 4) {
  console.error("usage: node scripts/check-client-ip.mjs https://<api-host> [requests>=4]");
  process.exit(2);
}

async function remaining(forged) {
  const headers = forged ? { "x-forwarded-for": forged } : {};
  const res = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(90_000) });
  await res.body?.cancel();
  const value = Number(res.headers.get("ratelimit-remaining"));
  if (!Number.isFinite(value)) throw new Error(`no RateLimit-Remaining header (status ${res.status})`);
  return value;
}

const seen = [];
for (let i = 0; i < count; i++) {
  // Every other request carries a different forged address.
  const forged = i % 2 ? `203.0.113.${i}` : null;
  seen.push(await remaining(forged));
}
const steps = seen.slice(1).map((v, i) => seen[i] - v);
const ok = steps.every((d) => d === 1);
console.log(`RateLimit-Remaining: ${seen.join(" ")}`);
if (ok) {
  console.log("PASS: one bucket for this caller, and a forged X-Forwarded-For is ignored.");
} else {
  console.log("FAIL: the limiter is not keyed by this caller's real address. Adjust TRUST_PROXY_HOPS and check again.");
  process.exit(1);
}
