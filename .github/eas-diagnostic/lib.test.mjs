// Offline tests for the EAS diagnostic parser. Run: node --test .github/eas-diagnostic/
// All fixtures are synthetic. No network, no token.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classify,
  lastMeaningfulLine,
  redact,
  parseEnvShort,
  envPresence,
  parseProjectInfo,
  summarizeBuilds,
  summarizeUsage,
  evaluate,
  PINNED_EAS_CLI,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANNER = [
  "★ eas-cli@27.2.0 is now available.",
  "To upgrade, run:",
  "npm install -g eas-cli",
  "Proceeding with outdated version.",
  "",
].join("\n");

// The exact shape of the two failed 31 Oct runs: banner first, cause last.
const PLUGIN_MISSING = `${BANNER}\nUsing EAS CLI without version control system is not recommended, use this mode only if you know what you are doing.\nFailed to resolve plugin for module "expo-router" relative to "/home/runner/work/arena/arena/movenrun/mobile". Do you have node modules installed?\n    Error: project:info command failed.\n`;
const BAD_FLAGS = `${BANNER}\nNonexistent flags: --json, --non-interactive\nSee more help with --help\n    Error: env:list command failed.\n`;

const FAKE_TOKEN = "Ab3dEfGh1JkLmN0pQrStUvWxYz012345abcdEFGH";
const FAKE_UUID = "73abbcb8-9466-4e52-b912-e2812e170abc";

test("31 Oct failure: missing node_modules is project_context_missing, not a permission problem", () => {
  const r = classify(1, PLUGIN_MISSING);
  assert.equal(r.class, "project_context_missing");
  assert.match(r.reason, /Failed to resolve plugin/);
  assert.doesNotMatch(r.reason, /eas-cli@|upgrade|home\/runner/);
});

test("31 Oct failure: unsupported env:list flags are invalid_command", () => {
  assert.equal(classify(1, BAD_FLAGS).class, "invalid_command");
  assert.match(classify(1, BAD_FLAGS).reason, /Nonexistent flags/);
});

test("banner-only stderr does not hide the cause and does not pass", () => {
  const r = classify(1, BANNER);
  assert.equal(r.class, "unknown");
  assert.notEqual(r.reason, "");
  assert.doesNotMatch(r.reason, /eas-cli@27/);
});

test("403, 401, 404, network and rate limit are told apart", () => {
  assert.equal(classify(1, `${BANNER}\nForbidden\n    Error: GraphQL request failed.\n`).class, "insufficient_permissions");
  assert.equal(classify(1, "Response status 403\n").class, "insufficient_permissions");
  assert.equal(classify(1, "An Expo user account is required to proceed.\n").class, "not_authenticated");
  assert.equal(classify(1, "HTTP 401 Unauthorized\n").class, "not_authenticated");
  assert.equal(classify(1, "Entity not found.\n    Error: project:info command failed.\n").class, "project_not_found");
  assert.equal(classify(1, "getaddrinfo ENOTFOUND api.expo.dev\n").class, "network");
  assert.equal(classify(1, "Request failed: 429 Too Many Requests\n").class, "rate_limited");
});

test("exit code decides success: warnings on a zero exit are ok, a non-zero exit is never ok", () => {
  assert.equal(classify(0, "Forbidden\nError: whatever").class, "ok");
  for (const err of ["", BANNER, "success", "Done"]) assert.notEqual(classify(1, err).class, "ok");
  assert.notEqual(classify(127, "").class, "ok");
});

test("the wrapper line is dropped in favour of the cause above it", () => {
  assert.equal(lastMeaningfulLine("Real cause here\n    Error: build:list command failed.\n"), "Real cause here");
  assert.equal(lastMeaningfulLine("Forbidden\n    Error: GraphQL request failed.\n"), "Forbidden / Error: GraphQL request failed.");
  assert.equal(lastMeaningfulLine("    Error: build:list command failed.\n"), "Error: build:list command failed.");
});

test("redact removes tokens, ids, emails, auth URLs, account handles and keys", () => {
  const dirty = [
    `token ${FAKE_TOKEN}`,
    `Bearer ${FAKE_TOKEN}`,
    `project ${FAKE_UUID}`,
    "owner someone@example.com",
    "see https://user:pass@expo.dev/accounts/acme/projects/movenrun?token=abc",
    "full name @acme-owner/movenrun",
    "key AIzaSyA1234567890abcdefghijklmnopqrstu",
    "key sb_publishable_abcdef123456",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    'Account "acme" not found. Available accounts: acme, other',
  ].join("\n");
  const clean = redact(dirty);
  for (const secret of [FAKE_TOKEN, FAKE_UUID, "someone@example.com", "user:pass", "/accounts/acme", "token=abc", "@acme-owner", "AIzaSyA", "sb_publishable_abcdef", "eyJhbGci", "acme, other"]) {
    assert.ok(!clean.includes(secret), `leaked: ${secret}`);
  }
  assert.match(clean, /https:\/\/expo\.dev/);
});

test("redact keeps variable names readable", () => {
  for (const n of ["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "GOOGLE_MAPS_ANDROID_API_KEY", "project_id_matches_app_json"]) {
    assert.equal(redact(n), n);
  }
});

const ENV_OUT = [
  "",
  "\u001b[1mEnvironment: preview\u001b[22m",
  "\u001b[1mEXPO_PUBLIC_API_URL\u001b[22m=https://movenrun-staging-api.onrender.com",
  "EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abcdef123456",
  "GOOGLE_MAPS_ANDROID_API_KEY=***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)",
  "SOMETHING_ELSE=***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)",
].join("\n");

test("env:list short output: names, visibility, staging URL match", () => {
  const vars = parseEnvShort(ENV_OUT);
  assert.equal(vars.get("GOOGLE_MAPS_ANDROID_API_KEY").visibility, "secret");
  assert.equal(vars.get("SOMETHING_ELSE").visibility, "sensitive");
  assert.equal(vars.get("EXPO_PUBLIC_API_URL").visibility, "plain");
  const p = envPresence(ENV_OUT);
  assert.ok(p.rows.every((r) => r.present));
  assert.equal(p.apiUrlMatchesStaging, "yes");
  // The presence summary must never carry a value.
  const s = JSON.stringify(p);
  assert.ok(!s.includes("sb_publishable_") && !s.includes("supabase.co") && !s.includes("onrender.com"));
});

test("env:list: wrong or hidden API URL and missing names are not passes", () => {
  assert.equal(envPresence("EXPO_PUBLIC_API_URL=https://movenrun-api.onrender.com\n").apiUrlMatchesStaging, "no");
  assert.equal(envPresence("EXPO_PUBLIC_API_URL=https://movenrun-staging-api.onrender.com.evil.test\n").apiUrlMatchesStaging, "no");
  assert.equal(envPresence("EXPO_PUBLIC_API_URL=https://movenrun-staging-api.onrender.com/\n").apiUrlMatchesStaging, "yes");
  assert.equal(envPresence("EXPO_PUBLIC_API_URL=***** (This is a sensitive env variable.)\n").apiUrlMatchesStaging, "unknown");
  assert.equal(envPresence("No variables found for this environment.\n").apiUrlMatchesStaging, "missing");
  assert.ok(envPresence("Environment: preview\nNo variables found for this environment.\n").rows.every((r) => !r.present));
  // A name only mentioned in prose or another environment heading is not a definition.
  assert.ok(!envPresence("Set GOOGLE_MAPS_ANDROID_API_KEY in the dashboard\n").rows[3].present);
});

test("project:info parsing", () => {
  const out = `fullName  @acme/movenrun\nID        ${FAKE_UUID}\n`;
  assert.deepEqual(parseProjectInfo(out), { owner: "acme", slug: "movenrun", projectId: FAKE_UUID });
  assert.deepEqual(parseProjectInfo("nothing"), { owner: null, slug: null, projectId: null });
});

test("build:list and account:usage summaries carry counts only", () => {
  const b = summarizeBuilds(JSON.stringify([{ id: FAKE_UUID, status: "FINISHED", buildProfile: "preview", gitCommitHash: "ac8d87b" }, { status: "ERRORED" }]));
  assert.deepEqual(b, { readable: true, count: 2, byStatus: { finished: 1, errored: 1 }, previewProfileBuilds: 1 });
  assert.ok(!JSON.stringify(b).includes(FAKE_UUID));
  assert.deepEqual(summarizeBuilds("not json"), { readable: false });
  const u = summarizeUsage(JSON.stringify({ account: { name: "acme", plan: "Free", billingPeriod: { daysRemaining: 12 } }, builds: { plan: { used: 3, limit: 15 }, android: { plan: { used: 3, limit: 15 } } } }));
  assert.equal(u.android.remaining, 12);
  assert.ok(!JSON.stringify(u).includes("acme"));
});

const ALL_OK = { whoami: { class: "ok" }, project_info: { class: "ok" }, env_list: { class: "ok" }, build_list: { class: "ok" }, account_usage: { class: "ok" } };
const goodInput = () => ({
  results: structuredClone(ALL_OK),
  env: envPresence(ENV_OUT),
  project: { projectId: FAKE_UUID },
  expectedProjectId: FAKE_UUID,
  easJsonPreviewEnv: "preview",
  builds: { readable: true, count: 0 },
  usage: { readable: true, plan: "Free", android: { used: 0, limit: 15, remaining: 15 } },
  cliVersion: PINNED_EAS_CLI,
});

test("gate: everything the CLI can see passes, overall still waits on owner rows", () => {
  const v = evaluate(goodInput());
  assert.equal(v.cli, "PASS");
  assert.equal(v.gate, "BLOCKED_ON_OWNER_CHECKS");
  assert.ok(v.rows.some((r) => r.id === "signing_keystore_sha1_matches" && r.status === "UNKNOWN"));
});

test("gate: no false success", () => {
  const cases = [
    (i) => (i.results.project_info = { class: "insufficient_permissions", reason: "Forbidden" }),
    (i) => (i.results.env_list = { class: "invalid_command", reason: "Nonexistent flags" }),
    (i) => (i.env = envPresence("EXPO_PUBLIC_API_URL=https://movenrun-staging-api.onrender.com\n")),
    (i) => (i.env = envPresence(ENV_OUT.replace("movenrun-staging-api", "movenrun-api"))),
    (i) => (i.project = { projectId: "00000000-0000-0000-0000-000000000000" }),
    (i) => (i.easJsonPreviewEnv = "production"),
    (i) => (i.cliVersion = "27.2.0"),
    (i) => (i.usage = { readable: true, android: { used: 15, limit: 15, remaining: 0 } }),
    (i) => (i.usage = { readable: false }),
    (i) => (i.results.account_usage = { class: "unknown", reason: "skipped" }),
    (i) => (i.builds = { readable: false }),
  ];
  for (const mutate of cases) {
    const i = goodInput();
    mutate(i);
    assert.notEqual(evaluate(i).cli, "PASS", mutate.toString());
  }
});

// End to end through summarize.mjs with a synthetic raw directory.
function runSummarize(files) {
  const root = mkdtempSync(join(tmpdir(), "eas-diag-"));
  const raw = join(root, "raw");
  const out = join(root, "out");
  const app = join(root, "app");
  mkdirSync(raw);
  mkdirSync(app);
  writeFileSync(join(app, "app.json"), JSON.stringify({ expo: { extra: { eas: { projectId: FAKE_UUID } } } }));
  writeFileSync(join(app, "eas.json"), JSON.stringify({ build: { preview: { environment: "preview" } } }));
  for (const [k, v] of Object.entries(files)) writeFileSync(join(raw, k), v);
  const r = spawnSync(process.execPath, [join(HERE, "summarize.mjs"), raw, out, app], { encoding: "utf8", env: { PATH: process.env.PATH } });
  return { ...r, raw, out };
}

test("summarize: the 31 Oct run shape now fails the job and deletes raw files", () => {
  const r = runSummarize({
    cli_version: "24.8.0\n",
    "whoami.exit": "0\n", "whoami.out": "acme\nsomeone@example.com\n", "whoami.err": BANNER,
    "project_info.exit": "1\n", "project_info.out": "", "project_info.err": PLUGIN_MISSING,
    "env_list.exit": "1\n", "env_list.out": "", "env_list.err": BAD_FLAGS,
    "build_list.exit": "1\n", "build_list.out": "", "build_list.err": PLUGIN_MISSING.replace("project:info", "build:list"),
  });
  assert.equal(r.status, 1);
  assert.equal(existsSync(r.raw), false);
  const summary = readFileSync(join(r.out, "eas-gate.json"), "utf8") + r.stdout + r.stderr;
  assert.match(summary, /project_context_missing/);
  assert.match(summary, /invalid_command/);
  for (const leak of ["someone@example.com", "acme", "home/runner", "eas-cli@27"]) assert.ok(!summary.includes(leak), `leaked ${leak}`);
});

test("summarize: a fully passing synthetic run exits 0 and prints no values", () => {
  const r = runSummarize({
    cli_version: "24.8.0\n",
    "whoami.exit": "0\n", "whoami.out": "acme\n", "whoami.err": "",
    "project_info.exit": "0\n", "project_info.out": `fullName  @acme/movenrun\nID        ${FAKE_UUID}\n`, "project_info.err": "",
    "env_list.exit": "0\n", "env_list.out": ENV_OUT, "env_list.err": "",
    "build_list.exit": "0\n", "build_list.out": "[]", "build_list.err": "",
    "account_usage.exit": "0\n", "account_usage.out": JSON.stringify({ account: { name: "acme", plan: "Free" }, builds: { plan: { used: 1, limit: 15 }, android: { plan: { used: 1, limit: 15 } } } }), "account_usage.err": "",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const all = readFileSync(join(r.out, "eas-gate.json"), "utf8") + readFileSync(join(r.out, "eas-gate.md"), "utf8") + r.stdout;
  for (const leak of ["acme", FAKE_UUID, "sb_publishable_", "supabase.co", "onrender.com"]) assert.ok(!all.includes(leak), `leaked ${leak}`);
  assert.match(all, /BLOCKED_ON_OWNER_CHECKS/);
});

test("summarize: a cause printed on stdout is still classified", () => {
  const r = runSummarize({
    cli_version: "24.8.0\n",
    "whoami.exit": "1\n", "whoami.out": "\nForbidden\n", "whoami.err": `${BANNER}\n    Error: GraphQL request failed.\n`,
  });
  assert.equal(r.status, 1);
  assert.match(readFileSync(join(r.out, "eas-gate.json"), "utf8"), /"whoami": "insufficient_permissions"/);
});

test("summarize: missing exit files fail closed", () => {
  const r = runSummarize({ cli_version: "24.8.0\n" });
  assert.equal(r.status, 1);
});

test("run-queries.sh never uses mutating commands or value-revealing flags", () => {
  const sh = readFileSync(join(HERE, "run-queries.sh"), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(sh, /set -x|--include-sensitive|--include-file-content|\bbuild\s+-p|env:(create|update|delete|push|pull|set)|credentials|\binit\b|build:configure|submit|secret:/);
  assert.match(sh, /env:list preview --format short/);
  assert.doesNotMatch(sh, /env:list[^\n]*--json/);
});
