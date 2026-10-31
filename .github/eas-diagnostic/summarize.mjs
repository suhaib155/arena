#!/usr/bin/env node
// Reads the raw files written by run-queries.sh, writes a sanitized summary
// (markdown + JSON), deletes the raw files, and exits 1 unless every
// CLI-checkable gate row passed.
//
// Usage: node summarize.mjs <raw-dir> <out-dir> <app-root>
// Runs WITHOUT the Expo token in its environment.

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  classify,
  envPresence,
  evaluate,
  parseProjectInfo,
  summarizeBuilds,
  summarizeUsage,
  redact,
} from "./lib.mjs";

const [rawDir, outDir, appRoot] = process.argv.slice(2);
if (!rawDir || !outDir || !appRoot) {
  console.error("usage: summarize.mjs <raw-dir> <out-dir> <app-root>");
  process.exit(2);
}

const read = (name) => (existsSync(join(rawDir, name)) ? readFileSync(join(rawDir, name), "utf8") : "");
const exitOf = (cmd) => {
  const t = read(`${cmd}.exit`).trim();
  return t === "" ? null : Number(t);
};

const COMMANDS = ["whoami", "project_info", "env_list", "env_list_account", "build_list", "account_usage"];
let report;
try {
  const results = {};
  for (const cmd of COMMANDS) {
    const code = exitOf(cmd);
    if (code === null) {
      if (cmd === "account_usage" && exitOf("project_info") !== 0) {
        results[cmd] = { class: "unknown", reason: "skipped: project owner unknown" };
      } else {
        results[cmd] = { class: "unknown", reason: "not run" };
      }
      continue;
    }
    // eas-cli prints some causes (for example "Forbidden") on stdout and the
    // wrapper error on stderr, so a failed command is classified on both.
    results[cmd] = classify(code, code === 0 ? "" : `${read(`${cmd}.out`)}\n${read(`${cmd}.err`)}`);
  }

  const appJson = JSON.parse(readFileSync(join(appRoot, "app.json"), "utf8"));
  const easJson = JSON.parse(readFileSync(join(appRoot, "eas.json"), "utf8"));
  const project = results.project_info.class === "ok" ? parseProjectInfo(read("project_info.out")) : null;
  const env =
    results.env_list.class === "ok" && results.env_list_account.class === "ok"
      ? envPresence(read("env_list.out"), read("env_list_account.out"))
      : null;
  const builds = results.build_list.class === "ok" ? summarizeBuilds(read("build_list.out")) : null;
  const usage = results.account_usage.class === "ok" ? summarizeUsage(read("account_usage.out")) : null;

  const verdict = evaluate({
    results,
    env,
    project,
    expectedProjectId: appJson?.expo?.extra?.eas?.projectId,
    easJsonPreviewEnv: easJson?.build?.preview?.environment,
    builds,
    usage,
    cliVersion: read("cli_version").trim() || null,
  });

  report = {
    sha: process.env.GITHUB_SHA ?? null,
    ref: process.env.GITHUB_REF_NAME ?? null,
    workingDirectory: "movenrun/mobile",
    exitCodes: Object.fromEntries(COMMANDS.map((c) => [c, exitOf(c)])),
    classes: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.class])),
    builds: builds ? { readable: builds.readable, count: builds.count, byStatus: builds.byStatus, previewProfileBuilds: builds.previewProfileBuilds } : null,
    ...verdict,
  };
} finally {
  // Raw output can hold plain env values and account names. It never leaves the runner.
  rmSync(rawDir, { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });
// Server text only ever reaches `reason` (redacted in classify) and `detail`
// (built from fixed strings plus that redacted reason). Re-redact `reason`;
// running `detail` through redact() would garble the fixed wording.
const json = JSON.stringify(report, (k, v) => (typeof v === "string" && k === "reason" ? redact(v) : v), 2);
writeFileSync(join(outDir, "eas-gate.json"), json + "\n");

const lines = [
  `## EAS gate (read-only diagnostic)`,
  ``,
  `Source ${report.sha ?? "?"} on ${report.ref ?? "?"}, working directory \`${report.workingDirectory}\`.`,
  ``,
  `| Check | Status | Detail |`,
  `|---|---|---|`,
  ...report.rows.map((r) => `| ${r.id} | ${r.status} | ${r.detail.replace(/\|/g, "/")} |`),
  ``,
  `CLI-checkable result: **${report.cli}**. Overall gate: **${report.gate}**.`,
];
writeFileSync(join(outDir, "eas-gate.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
process.exit(report.cli === "PASS" ? 0 : 1);
