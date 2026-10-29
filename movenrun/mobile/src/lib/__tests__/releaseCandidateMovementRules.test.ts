/**
 * Android Play v1 release-candidate movement-rule guards.
 *
 * 1. The rejected blanket stationary-drift rule (path longer than 4x the
 *    ground it spans, plus the phone scatter guard; draft #154) must not be in
 *    any source that ships: the app, the shared domain module the app and the
 *    server both run, or the server's movement verification.
 * 2. The replacement stationary-risk rule (#166) is selected only by a server
 *    environment variable. Nothing in the app may name that variable or a rule
 *    id, so no client request can switch it on.
 * 3. The app reads exactly the public build variables the release runbooks
 *    list, and no others.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MOBILE = process.cwd();
const MOVENRUN = join(MOBILE, "..");

function sources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "__tests__" || name === "_legacy") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const SHIPPING = [
  join(MOBILE, "app"),
  join(MOBILE, "src"),
  join(MOVENRUN, "shared", "src"),
  join(MOVENRUN, "backend", "src", "movement"),
].flatMap((d) => sources(d));

const DRIFT_RULE_MARKERS = [
  "STATIONARY_DRIFT_POLICY",
  "stationaryDriftProblems",
  "maxPathToDiameter",
  "wanderWindowMs",
  "scatterMultiple",
];

test("the rejected 4x stationary-drift rule is absent from every shipping source", () => {
  assert.ok(SHIPPING.length > 100, "source walk found too few files to be meaningful");
  const hits: string[] = [];
  for (const file of SHIPPING) {
    const text = readFileSync(file, "utf8");
    for (const marker of DRIFT_RULE_MARKERS) {
      if (text.includes(marker)) hits.push(`${relative(MOVENRUN, file)}: ${marker}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the shared evidence module exports no stationary-drift check", async () => {
  const evidence = await import("@movenrun/shared/evidence");
  const names = Object.keys(evidence).filter((k) => /stationary|drift|wander/i.test(k));
  assert.deepEqual(names, []);
});

test("no app source can name or select the server stationary-risk rule", () => {
  const app = [join(MOBILE, "app"), join(MOBILE, "src")].flatMap((d) => sources(d));
  const hits = app.filter((file) =>
    /MOVEMENT_STATIONARY_RISK_RULE|stationary-risk\/v1|stationaryRiskRule/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(hits.map((f) => relative(MOVENRUN, f)), []);
});

test("the app reads only the documented public build variables", () => {
  const allowed = new Set([
    "EXPO_PUBLIC_API_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_WEB_URL",
  ]);
  const seen = new Set<string>();
  for (const file of [join(MOBILE, "app"), join(MOBILE, "src")].flatMap((d) => sources(d))) {
    for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) seen.add(m[1]!);
  }
  /* SOMETHING is a placeholder inside a doc comment in mapAvailability.ts. */
  const unexpected = [...seen].filter((name) => !allowed.has(name) && name !== "SOMETHING");
  assert.deepEqual(unexpected.sort(), []);
});
