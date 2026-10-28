/**
 * The Render Blueprint (`render.yaml` at the repository root) is what the
 * owner deploys. These checks keep it on the free plan, on the reviewed
 * deploy branch, with migrations before start and no secret in the file.
 * Plain-text checks, no YAML library: the file is small and flat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const blueprint = readFileSync(new URL("../../../../render.yaml", import.meta.url), "utf8");
const lines = blueprint.split("\n").filter((l) => !l.trim().startsWith("#"));
const field = (key: string) => {
  const found = lines.filter((l) => new RegExp(`^\\s+(?:- )?${key}:`).test(l)).map((l) => l.split(/:(.*)/s)[1].trim());
  assert.equal(found.length, 1, `${key} appears once`);
  return found[0];
};

test("one free web service in Virginia, no Render database, nothing paid", () => {
  assert.equal(field("type"), "web");
  assert.equal(field("plan"), "free");
  assert.equal(field("region"), "virginia");
  assert.equal(field("numInstances"), "1");
  assert.equal(field("runtime"), "node");
  assert.ok(!/^databases:/m.test(blueprint), "no Render PostgreSQL: the database is Supabase Free");
  assert.ok(!/\b(starter|standard|pro|plus)\b/i.test(lines.join("\n").replace(/plan: free/, "")), "no paid plan named");
});

test("deploys the reviewed deploy branch by hand only, never the pre-security release branch", () => {
  assert.equal(field("branch"), "deploy/render-free-staging");
  assert.equal(field("autoDeployTrigger"), "off");
});

test("installs only the API's dependencies from the lockfile, builds it, migrates before start, and checks readiness", () => {
  assert.equal(field("rootDir"), "movenrun");
  assert.match(field("buildCommand"), /yarn workspaces focus @movenrun\/backend && yarn workspace @movenrun\/backend build$/);
  assert.equal(field("startCommand"), "yarn workspace @movenrun/backend db:migrate && yarn workspace @movenrun/backend start");
  assert.equal(field("healthCheckPath"), "/ready");
});

test("secrets are set in the dashboard only; public values are the agreed ones", () => {
  const env = new Map<string, string>();
  const block = blueprint.slice(blueprint.indexOf("envVars:"));
  for (const m of block.matchAll(/- key: (\w+)\n\s+(value|sync|generateValue): (.+)/g)) env.set(m[1], `${m[2]}=${m[3].trim()}`);
  for (const secret of ["DATABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) assert.equal(env.get(secret), "sync=false", secret);
  assert.equal(env.get("IDENTITY_SESSION_PEPPER"), "generateValue=true");
  assert.equal(env.get("NODE_ENV"), "value=production");
  assert.equal(env.get("NODE_VERSION"), 'value="22"');
  assert.equal(env.get("SUPABASE_URL"), "value=https://tavxmwuwkeynbnzfwove.supabase.co");
  assert.equal(env.get("CORS_ORIGINS"), "value=https://movenrun.xyz");
  assert.equal(env.get("IDENTITY_AUTH_DOMAIN"), "value=movenrun.xyz");
  assert.equal(env.get("TRUST_PROXY_HOPS"), 'value="1"');
  assert.equal(env.get("TRUST_PROXY"), "value=render-cloudflare");
  assert.ok(!/RESEND|OTP_PEPPER|REVIEW_CODE|REVIEW_EMAIL/.test(blueprint), "no email-code settings");
  assert.ok(!/JWT_SECRET/.test(blueprint), "no legacy JWT shared-secret variable: the API refuses to start with one");
  assert.ok(!/sb_secret_|service_role|postgres(ql)?:\/\/[^<\s]+@/.test(blueprint), "no key or connection string in the file");
});

test("the blueprint's CORS allowlist trusts the apex only: www, http and look-alikes get no CORS grant", async () => {
  const { default: express } = await import("express");
  const { createCorsMiddleware } = await import("../middleware/security.js");
  const block = blueprint.slice(blueprint.indexOf("envVars:"));
  const origins = /- key: CORS_ORIGINS\n\s+value: (.+)/.exec(block)![1].trim();
  assert.equal(origins, "https://movenrun.xyz");
  const app = express();
  app.use(createCorsMiddleware({ NODE_ENV: "production", CORS_ORIGINS: origins }));
  app.post("/identity/auth/google/complete", (_req, res) => { res.json({}); });
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const preflight = (origin: string) => fetch(`${base}/identity/auth/google/complete`, {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,authorization" },
  });
  try {
    const apex = await preflight("https://movenrun.xyz");
    assert.equal(apex.headers.get("access-control-allow-origin"), "https://movenrun.xyz");
    assert.equal(apex.headers.get("access-control-allow-credentials"), null);
    for (const origin of ["https://www.movenrun.xyz", "http://movenrun.xyz", "https://movenrun.xyz.evil.example", "https://evilmovenrun.xyz", "null"]) {
      assert.equal((await preflight(origin)).headers.get("access-control-allow-origin"), null, origin);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
