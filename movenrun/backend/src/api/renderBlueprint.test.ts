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

test("installs immutably, builds the API, migrates before start, and checks readiness", () => {
  assert.equal(field("rootDir"), "movenrun");
  assert.match(field("buildCommand"), /yarn install --immutable && yarn workspace @movenrun\/backend build$/);
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
  assert.ok(!/RESEND|OTP_PEPPER|REVIEW_CODE|REVIEW_EMAIL/.test(blueprint), "no email-code settings");
  assert.ok(!/sb_secret_|service_role|postgres(ql)?:\/\/[^<\s]+@/.test(blueprint), "no key or connection string in the file");
});
